package org.openforis.collect.earth.app.service.data;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Observer;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

import org.apache.commons.io.FileUtils;
import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.data.ProcessJobs.ProcessFailedException;
import org.openforis.collect.earth.app.service.jobs.Job;
import org.openforis.collect.earth.app.service.jobs.JobContext;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.io.ReferenceDataImportStatus;
import org.openforis.collect.io.data.CSVDataImportProcess;
import org.openforis.collect.io.data.DataImportState;
import org.openforis.collect.io.data.DataImportSummary;
import org.openforis.collect.io.data.DataImportSummary.FileErrorItem;
import org.openforis.collect.io.data.DataImportSummaryItem;
import org.openforis.collect.io.data.XMLDataImportProcess;
import org.openforis.collect.model.CollectRecordSummary;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import net.lingala.zip4j.ZipFile;

/**
 * The imports of the Data menu, as jobs: what ImportActionListener, ImportXMLDialogProcessMonitor and
 * ImportProcessMonitorDialog did, without Swing.
 * <p>
 * The import of a ZIP goes in two jobs, as the dialog asked about the conflicting records in the middle: summaries()
 * reads the files and says what is in them, keeping the prepared processes under a token; importPrepared() imports
 * them with the page's answers. A token is forgotten FORGET_AFTER_MINUTES after it was made, or once imported.
 */
@Service
public class ImportService {

	static final long FORGET_AFTER_MINUTES = 30;

	/** The token names no prepared import: never, imported already, or forgotten. */
	public static class ExpiredImportException extends Exception {
		private static final long serialVersionUID = 1L;

		public ExpiredImportException() {
			super("The prepared import is no longer there");
		}
	}

	/** A file read by summaries(), ready to be imported. */
	private static final class PreparedFile {
		final File original;
		/** The file the process reads: the original, or its transformation for a .collect-data file */
		File file;
		XMLDataImportProcess process;
		List<DataImportSummaryItem> conflicts = Collections.emptyList();
		int toImport;
		final List<String> errors = new ArrayList<>();

		PreparedFile(File original) {
			this.original = original;
		}
	}

	private static final class Prepared {
		final long createdAt;
		final List<PreparedFile> files = new ArrayList<>();

		Prepared(long createdAt) {
			this.createdAt = createdAt;
		}
	}

	private final Logger logger = LoggerFactory.getLogger(ImportService.class);
	private final DataImportExportService data;
	private final EarthSurveyService surveys;
	/** Opens the plots again after an import, which changes their statuses */
	private final Runnable reload;
	private final LongSupplier now;
	private final Map<String, Prepared> prepared = new ConcurrentHashMap<>();

	@Autowired
	public ImportService(DataImportExportService data, EarthSurveyService surveys) {
		this(data, surveys, EarthApp::reloadPlots, System::currentTimeMillis);
	}

	/** For the tests: the reload of the plots and the clock stood in for. */
	public ImportService(DataImportExportService data, EarthSurveyService surveys, Runnable reload, LongSupplier now) {
		this.data = data;
		this.surveys = surveys;
		this.reload = reload;
		this.now = now;
	}

	/** What the CSV update needs in the file: the key attributes first, then the attributes to update. */
	public Map<String, Object> csvInfo() {
		String[] keys = surveys.getKeyNamesForSurvey();
		return Collections.singletonMap("keyAttributes", keys == null ? Collections.emptyList() : Arrays.asList(keys));
	}

	/**
	 * The first job of a ZIP import: reads each file and says what it holds. The result is {@code {token, files:
	 * [{path, name, toImport, conflicts: [{keys, modified, completion, existingModified, existingCompletion}],
	 * errors}]}}; a file that cannot be read has its errors and is not imported, the others go on. A cancelled job
	 * prepares nothing.
	 */
	public Job summaries(List<String> paths, boolean includeNonFinished) {
		return context -> {
			forgetOld();
			Prepared batch = new Prepared(now.getAsLong());
			for (String path : paths) {
				if (context.isCancelled()) {
					break;
				}
				PreparedFile file = new PreparedFile(new File(path));
				batch.files.add(file);
				context.progress(-1, Messages.getString("ImportDialogProcessMonitor.8") + " " + file.original.getName());
				try {
					summarise(file, includeNonFinished, context);
				} catch (Exception e) {
					logger.error("Error reading the data to import from " + file.original, e);
					file.errors.add(Messages.getString("CollectEarthWindow.7") + ": " + StringUtils.defaultIfBlank(e.getMessage(), e.getClass().getSimpleName()));
					IOUtils.closeQuietly(file.process);
					file.process = null;
				}
			}
			String token = null;
			if (!context.isCancelled() && batch.files.stream().anyMatch(f -> f.process != null)) {
				token = UUID.randomUUID().toString();
				prepared.put(token, batch);
			} else {
				close(batch);
			}
			Map<String, Object> result = new LinkedHashMap<>();
			result.put("token", token);
			List<Map<String, Object>> files = new ArrayList<>();
			for (PreparedFile file : batch.files) {
				files.add(summaryOf(file));
			}
			result.put("files", files);
			return result;
		};
	}

	private void summarise(PreparedFile file, boolean includeNonFinished, JobContext context) throws Exception {
		if (!file.original.isFile()) {
			throw new IOException(Messages.getString("SettingsPage.sampleFile.missing"));
		}
		file.file = isCollectDataExport(file.original) ? transformCollectDataFile(file.original) : file.original;
		XMLDataImportProcess process = data.getImportSummary(file.file, includeNonFinished);
		file.process = process;
		process.callAndObserve(observer(process, context, Messages.getString("ImportDialogProcessMonitor.2")));
		DataImportState state = process.getState();
		if (state != null && state.isCancelled()) {
			return;
		}
		DataImportSummary summary = process.getSummary();
		if (summary == null) {
			throw new IOException(state != null && StringUtils.isNotBlank(state.getErrorMessage()) ? state.getErrorMessage()
					: Messages.getString("DataPage.import.noSummary"));
		}
		file.conflicts = summary.getConflictingRecords() == null ? Collections.emptyList() : new ArrayList<>(summary.getConflictingRecords());
		file.toImport = summary.getRecordsToImport() == null ? 0 : summary.getRecordsToImport().size();
		if (summary.getSkippedFileErrors() != null) {
			for (FileErrorItem skipped : summary.getSkippedFileErrors()) {
				file.errors.add(skipped.getFileName() + ": " + skipped.getErrors());
			}
		}
	}

	/** Reports the count of the process's state as the job's progress, and cancels the process when the job is cancelled. */
	private static Observer observer(XMLDataImportProcess process, JobContext context, String step) {
		return (observable, arg) -> {
			if (observable instanceof DataImportState) {
				DataImportState state = (DataImportState) observable;
				int percent = state.getTotal() > 0 ? (int) (100L * state.getCount() / state.getTotal()) : -1;
				context.progress(percent, step + " " + state.getCount() + "/" + state.getTotal());
			}
			if (context.isCancelled()) {
				process.cancel();
			}
		};
	}

	private static Map<String, Object> summaryOf(PreparedFile file) {
		Map<String, Object> json = new LinkedHashMap<>();
		json.put("path", file.original.getAbsolutePath());
		json.put("name", file.original.getName());
		json.put("toImport", file.toImport);
		List<Map<String, Object>> conflicts = new ArrayList<>();
		for (DataImportSummaryItem item : file.conflicts) {
			Map<String, Object> conflict = new LinkedHashMap<>();
			CollectRecordSummary record = item.getRecordSummary();
			CollectRecordSummary existing = item.getConflictingRecordSummary();
			conflict.put("keys", record == null || record.getRootEntityKeyValues() == null ? Collections.emptyList() : record.getRootEntityKeyValues());
			conflict.put("modified", millis(record == null ? null : record.getModifiedDate()));
			conflict.put("completion", item.getRecordCompletionPercent());
			conflict.put("existingModified", millis(existing == null ? null : existing.getModifiedDate()));
			conflict.put("existingCompletion", item.getConflictingRecordCompletionPercent());
			conflicts.add(conflict);
		}
		json.put("conflicts", conflicts);
		json.put("errors", new ArrayList<>(file.errors));
		return json;
	}

	private static Long millis(Date date) {
		return date == null ? null : date.getTime();
	}

	/**
	 * The second job: imports the prepared files, the conflicting records of those the page said to overwrite, then
	 * reloads the plots. The result is {@code {imported, overwritten}}.
	 *
	 * @param overwriteByPath the paths (as summaries() answered them) whose conflicting records are to be overwritten
	 * @throws ExpiredImportException when the token is not there
	 */
	public Job importPrepared(String token, List<String> overwriteByPath) throws ExpiredImportException {
		forgetOld();
		Prepared batch = token == null ? null : prepared.remove(token);
		if (batch == null) {
			throw new ExpiredImportException();
		}
		return context -> {
			int imported = 0;
			int overwritten = 0;
			try {
				for (PreparedFile file : batch.files) {
					if (file.process == null || context.isCancelled()) {
						continue;
					}
					boolean overwrite = overwriteByPath != null && overwriteByPath.contains(file.original.getAbsolutePath());
					List<DataImportSummaryItem> conflicts = overwrite ? file.conflicts : Collections.emptyList();
					int total = file.toImport + conflicts.size();
					context.progress(-1, Messages.getString("ImportDialogProcessMonitor.11") + " " + total);
					DataImportState state = file.process.getState();
					if (state != null) {
						state.addObserver(observer(file.process, context, Messages.getString("ImportDialogProcessMonitor.2")));
					}
					data.importRecordsFrom(file.file, file.process, conflicts);
					imported += total;
					overwritten += conflicts.size();
					context.message(file.original.getName() + ": " + Messages.getString("ImportDialogProcessMonitor.5") + " " + total);
				}
			} finally {
				close(batch);
				if (imported > 0) {
					reload.run();
				}
			}
			Map<String, Object> result = new LinkedHashMap<>();
			result.put("imported", imported);
			result.put("overwritten", overwritten);
			return result;
		};
	}

	private static void close(Prepared batch) {
		for (PreparedFile file : batch.files) {
			IOUtils.closeQuietly(file.process);
			file.process = null;
			if (file.file != null && file.file != file.original) {
				FileUtils.deleteQuietly(file.file);
			}
		}
	}

	private void forgetOld() {
		long before = now.getAsLong() - TimeUnit.MINUTES.toMillis(FORGET_AFTER_MINUTES);
		prepared.entrySet().removeIf(entry -> {
			if (entry.getValue().createdAt < before) {
				close(entry.getValue());
				return true;
			}
			return false;
		});
	}

	/** For the tests */
	int preparedCount() {
		return prepared.size();
	}

	/**
	 * The update of the records from CSV files, one after the other, as the Swing thread did: a file whose columns
	 * are wrong is reported and skipped, the others update. The result is {@code {files: [{path, name, updated, errors}]}}.
	 */
	public Job updateFromCsv(List<String> paths) {
		return context -> {
			List<Map<String, Object>> files = new ArrayList<>();
			for (String path : paths) {
				if (context.isCancelled()) {
					break;
				}
				File file = new File(path);
				Map<String, Object> entry = new LinkedHashMap<>();
				entry.put("path", file.getAbsolutePath());
				entry.put("name", file.getName());
				List<String> errors = new ArrayList<>();
				long updated = 0;
				context.progress(-1, Messages.getString("ImportDialogProcessMonitor.8") + " " + file.getName());
				try {
					CSVDataImportProcess process = data.getCsvImporterProcess(file);
					process.init();
					ReferenceDataImportStatus<?> status = process.getStatus();
					if (status != null && status.isError()) {
						errors.add(StringUtils.defaultIfBlank(status.getErrorMessage(), Messages.getString("DataPage.processFailed")));
						errors.addAll(ProcessJobs.parsingErrors(status));
					} else {
						if (status != null) {
							status.setTotal(countLines(file));
						}
						try {
							ReferenceDataImportStatus<?> ended = ProcessJobs.run(process, context, Messages.getString("ImportProcessMonitorDialog.0"));
							updated = ended == null ? 0 : ended.getProcessed();
						} catch (ProcessFailedException e) {
							errors.add(e.getMessage());
							errors.addAll(e.getDetails());
						}
					}
				} catch (Exception e) {
					logger.error("Error updating the records from " + file, e);
					errors.add(Messages.getString("CollectEarthWindow.7") + ": " + StringUtils.defaultIfBlank(e.getMessage(), e.getClass().getSimpleName()));
				}
				for (String error : errors) {
					context.message(file.getName() + " - " + error);
				}
				entry.put("updated", updated);
				entry.put("errors", errors);
				files.add(entry);
			}
			return Collections.singletonMap("files", files);
		};
	}

	private static long countLines(File file) {
		long count = 0;
		try (BufferedReader reader = new BufferedReader(new InputStreamReader(Files.newInputStream(file.toPath()), StandardCharsets.UTF_8))) {
			while (reader.readLine() != null) {
				count++;
			}
		} catch (IOException e) {
			LoggerFactory.getLogger(ImportService.class).warn("The lines of {} could not be counted", file, e);
		}
		return count;
	}

	private static boolean isCollectDataExport(File file) {
		return file.getName().endsWith(".collect-data");
	}

	/**
	 * A file exported by Collect (idml.xml and data/1..3 folders) rewritten as the ZIP Collect Earth exports, which the
	 * import process reads: the survey definition and the files of each step at the root. Temporary, deleted with the
	 * prepared import.
	 */
	static File transformCollectDataFile(File collectData) throws Exception {
		File tempFolder = Files.createTempDirectory("tempCE").toFile();
		try {
			try (ZipFile src = new ZipFile(collectData)) {
				src.extractAll(tempFolder.getAbsolutePath());
			}
			File transformed = new File(tempFolder.getParentFile(), "transform" + Math.abs(new SecureRandom().nextInt()) + ".zip");
			transformed.deleteOnExit();
			try (ZipFile dst = new ZipFile(transformed)) {
				CollectEarthUtils.addFileToZip(dst, new File(tempFolder, "idml.xml"), "idml.xml");
				for (String step : new String[] { "1", "2", "3" }) {
					CollectEarthUtils.addFolderToZip(dst, new File(tempFolder, "data" + File.separator + step));
				}
			}
			return transformed;
		} finally {
			FileUtils.deleteQuietly(tempFolder);
		}
	}
}

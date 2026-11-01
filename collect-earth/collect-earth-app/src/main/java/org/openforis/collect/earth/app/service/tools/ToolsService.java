package org.openforis.collect.earth.app.service.tools;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.KmlImportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.MissingPlotService;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao;
import org.openforis.collect.earth.app.service.jobs.Job;
import org.openforis.collect.earth.app.service.jobs.JobProgress;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.utils.ProduceCsvFiles;
import org.openforis.collect.io.metadata.collectearth.CollectEarthGridTemplateGenerator;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.opencsv.CSVReader;

/**
 * The utilities of the Tools menu, for the pages: what MissingPlotsListener, FileDividerToolDlg,
 * RemovePlotsFromDBDlg and KmlImportService.loadFromKml did with their Swing dialogs, as jobs or calls.
 */
@Service
public class ToolsService {

	static final int MAX_FILES_TO_DIVIDE_INTO = 500;

	/** The request cannot be done: its code names the field, its message says what to do. */
	public static class InvalidToolRequestException extends Exception {
		private static final long serialVersionUID = 1L;
		private final String code;

		public InvalidToolRequestException(String code, String message) {
			super(message);
			this.code = code;
		}

		public String getCode() {
			return code;
		}
	}

	/** What Divide large CSV files asks for (FileDividerToolDlg) */
	public static class DivideCsvRequest {
		public String source;
		public String folder;
		public int files = 1;
		public boolean randomize;
		/** The column (0-based, as the expected headers) whose values the plots are stratified by, or null */
		public Integer column;
	}

	/** Divides the CSV into files, answering the folder written (ProduceCsvFiles). */
	public interface CsvDivider {
		File divide(CollectSurvey survey, DivideCsvRequest request);
	}

	private final Logger logger = LoggerFactory.getLogger(ToolsService.class);
	private final MissingPlotService missingPlots;
	private final EarthSurveyService surveys;
	private final LocalPropertiesService properties;
	private final RecordManager records;
	private final CloudSyncQueueDao cloudQueue;
	private final KmlImportService kml;
	private final CsvDivider divider;
	private final Function<CollectSurvey, List<String>> expectedHeaders;
	private final Runnable reload;

	@Autowired
	public ToolsService(MissingPlotService missingPlots, EarthSurveyService surveys, LocalPropertiesService properties, RecordManager records,
			CloudSyncQueueDao cloudQueue, KmlImportService kml) {
		this(missingPlots, surveys, properties, records, cloudQueue, kml,
				(survey, request) -> new ProduceCsvFiles(survey, request.source, request.folder, request.randomize, request.column, request.files)
						.divideIntoFiles(),
				survey -> new CollectEarthGridTemplateGenerator().getExpectedHeaders(survey), EarthApp::reloadPlots);
	}

	/** For the tests: the divider, the expected headers and the reload of the plots stood in for. */
	public ToolsService(MissingPlotService missingPlots, EarthSurveyService surveys, LocalPropertiesService properties, RecordManager records,
			CloudSyncQueueDao cloudQueue, KmlImportService kml, CsvDivider divider, Function<CollectSurvey, List<String>> expectedHeaders,
			Runnable reload) {
		this.missingPlots = missingPlots;
		this.surveys = surveys;
		this.properties = properties;
		this.records = records;
		this.cloudQueue = cloudQueue;
		this.kml = kml;
		this.divider = divider;
		this.expectedHeaders = expectedHeaders;
		this.reload = reload;
	}

	// ---------- Find missing plots ----------

	/**
	 * The plots of the files chosen that are not in the database, or not finished: the report of the Swing dialog as
	 * data. The result is {@code {text, totalPlots, totalMissing, files: [{name, missing: [[row]]}], csv}}, the csv a
	 * temporary file with the missing plots, to save as the dialog's button did, or null when none is missing.
	 */
	public Job missingPlots(List<String> paths) throws InvalidToolRequestException {
		List<File> files = existingFiles(paths);
		return context -> {
			JobProgress progress = new JobProgress(context);
			progress.setMessage(Messages.getString("MissingPlotsListener.1"));
			Map<String, List<String[]>> all = missingPlots.getPlotDataByFile(files.toArray(new File[0]));
			Map<String, List<String[]>> missing = missingPlots.getMissingPlotsByFile(all, progress);
			String text = missingPlots.getMissingPlotInformation(all, missing);
			File csv = missingPlots.getMissingPlotFile(missing);
			int totalPlots = 0;
			for (List<String[]> rows : all.values()) {
				totalPlots += rows.size();
			}
			int totalMissing = 0;
			List<Map<String, Object>> perFile = new ArrayList<>();
			for (Map.Entry<String, List<String[]>> entry : missing.entrySet()) {
				totalMissing += entry.getValue().size();
				Map<String, Object> file = new LinkedHashMap<>();
				file.put("name", new File(entry.getKey()).getName());
				file.put("path", entry.getKey());
				List<List<String>> rows = new ArrayList<>();
				for (String[] row : entry.getValue()) {
					rows.add(Arrays.asList(row));
				}
				file.put("missing", rows);
				perFile.add(file);
			}
			Map<String, Object> result = new LinkedHashMap<>();
			result.put("text", text);
			result.put("totalPlots", totalPlots);
			result.put("totalMissing", totalMissing);
			result.put("files", perFile);
			result.put("csv", csv == null ? null : csv.getAbsolutePath());
			return result;
		};
	}

	private static List<File> existingFiles(List<String> paths) throws InvalidToolRequestException {
		if (paths == null || paths.isEmpty()) {
			throw new InvalidToolRequestException("files.none", Messages.getString("DataPage.import.noFiles"));
		}
		List<File> files = new ArrayList<>();
		for (String path : paths) {
			File file = new File(StringUtils.trimToEmpty(path));
			if (!file.isFile()) {
				throw new InvalidToolRequestException("files.missing", Messages.getString("FilesController.missing") + ": " + path);
			}
			files.add(file);
		}
		return files;
	}

	// ---------- Divide large CSV files ----------

	/** The columns a plots file of the survey has, to stratify by; none without a survey. */
	public List<String> divideCsvColumns() {
		CollectSurvey survey = surveys.getCollectSurvey();
		return survey == null ? Collections.emptyList() : expectedHeaders.apply(survey);
	}

	/** Divides the file as FileDividerToolDlg did; the result is {@code {path}}, the folder written. */
	public Job divideCsv(DivideCsvRequest request) throws InvalidToolRequestException {
		if (request == null || StringUtils.isBlank(request.source) || !new File(request.source.trim()).isFile()) {
			throw new InvalidToolRequestException("divide.source", Messages.getString("ToolsPage.divide.noSource"));
		}
		if (StringUtils.isBlank(request.folder) || !new File(request.folder.trim()).isDirectory()) {
			throw new InvalidToolRequestException("divide.folder", Messages.getString("ToolsPage.divide.noFolder"));
		}
		if (request.files < 1 || request.files > MAX_FILES_TO_DIVIDE_INTO) {
			throw new InvalidToolRequestException("divide.files",
					String.format(Messages.getString("PropertyValidators.valueRange"), 1, MAX_FILES_TO_DIVIDE_INTO));
		}
		DivideCsvRequest clean = new DivideCsvRequest();
		clean.source = request.source.trim();
		clean.folder = request.folder.trim();
		clean.files = request.files;
		clean.randomize = request.randomize;
		clean.column = request.column;
		return context -> {
			context.progress(-1, Messages.getString("FileDivider.3"));
			File written = divider.divide(surveys.getCollectSurvey(), clean);
			return Collections.singletonMap("path", written == null ? clean.folder : written.getAbsolutePath());
		};
	}

	// ---------- Delete plots using a CSV ----------

	/** The names of the key attributes of the survey, which the CSV's header must be. */
	public List<String> keyAttributeNames() {
		CollectSurvey survey = surveys.getCollectSurvey();
		if (survey == null) {
			return Collections.emptyList();
		}
		List<String> names = new ArrayList<>();
		for (AttributeDefinition key : survey.getSchema().getRootEntityDefinitions().get(0).getKeyAttributeDefinitions()) {
			names.add(key.getName());
		}
		return names;
	}

	/**
	 * Whether the CSV can be used to delete plots: a CSV whose header is the key attribute names, as
	 * RemovePlotsFromDBDlg checked. The answer is {@code {ok, expected, found, message}}.
	 */
	public Map<String, Object> deletePlotsCheck(String path) {
		List<String> expected = keyAttributeNames();
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("expected", expected);
		List<String> found = Collections.emptyList();
		boolean ok = false;
		String message = null;
		File file = new File(StringUtils.trimToEmpty(path));
		if (StringUtils.isBlank(path) || !file.isFile()) {
			message = Messages.getString("FilesController.missing");
		} else {
			try (CSVReader reader = CsvReaderUtils.getCsvReader(file.getAbsolutePath(), false)) {
				// The file only lists the plot keys, so it has as many columns as keys and not the three of a plot file
				if (!CsvReaderUtils.isCsvFile(file.getAbsolutePath(), Math.max(1, expected.size()))) {
					message = String.format(Messages.getString("RemovePlotsDialog.6"), file.getAbsolutePath());
				} else {
					String[] header = reader.readNext();
					found = header == null ? Collections.emptyList() : Arrays.asList(header);
					if (!expected.equals(found)) {
						message = String.format(Messages.getString("RemovePlotsDialog.5"), expected, StringUtils.abbreviate(found.toString(), 35));
					} else {
						ok = true;
					}
				}
			} catch (Exception e) {
				logger.error("Error while checking the CSV of plots to delete " + file, e);
				message = String.format(Messages.getString("RemovePlotsDialog.7"), file.getAbsolutePath(), e.getMessage());
			}
		}
		answer.put("ok", ok);
		answer.put("found", found);
		answer.put("message", message);
		return answer;
	}

	/**
	 * Deletes the plots whose keys the CSV lists, as RemovePlotsFromDBDlg did: each row's outcome goes to the log, the
	 * result is {@code {deleted, notFound, failed}}, and the plots are reloaded when any was deleted.
	 */
	public Job deletePlots(String path) throws InvalidToolRequestException {
		Map<String, Object> check = deletePlotsCheck(path);
		if (!Boolean.TRUE.equals(check.get("ok"))) {
			throw new InvalidToolRequestException("delete.csv", (String) check.get("message"));
		}
		File file = new File(path.trim());
		return context -> {
			int deleted = 0;
			int notFound = 0;
			int failed = 0;
			List<String[]> rows;
			try (CSVReader reader = CsvReaderUtils.getCsvReader(file.getAbsolutePath(), false)) {
				rows = reader.readAll();
			}
			int total = Math.max(0, rows.size() - 1);
			JobProgress progress = new JobProgress(context);
			progress.setMessage(Messages.getString("RemovePlotsDialog.8"));
			try {
				for (int i = 1; i < rows.size() && !context.isCancelled(); i++) {
					String[] row = rows.get(i);
					progress.updateProgress(i, total);
					CollectRecord record = surveys.loadRecord(row);
					if (record == null) {
						notFound++;
						context.message(String.format(Messages.getString("RemovePlotsDialog.10"), Arrays.toString(row)));
						continue;
					}
					try {
						records.delete(record.getId());
						enqueueTombstone(row);
						deleted++;
						context.message(String.format(Messages.getString("RemovePlotsDialog.20"), Arrays.toString(row)));
					} catch (Exception e) {
						failed++;
						logger.error("Error deleting plot with ID " + Arrays.toString(row), e);
						context.message(String.format(Messages.getString("RemovePlotsDialog.21"), Arrays.toString(row), e.getMessage()));
					}
				}
			} finally {
				if (deleted > 0) {
					reload.run();
				}
			}
			Map<String, Object> result = new LinkedHashMap<>();
			result.put("deleted", deleted);
			result.put("notFound", notFound);
			result.put("failed", failed);
			return result;
		};
	}

	/**
	 * With cloud sync on, a deletion tombstone goes to the sync queue so the plot is deleted on the server too. Never
	 * throws: a failed enqueue must not undo the local deletion.
	 */
	private void enqueueTombstone(String[] row) {
		if (!properties.isCloudSyncEnabled()) {
			return;
		}
		try {
			CollectSurvey survey = surveys.getCollectSurvey();
			cloudQueue.enqueue(String.join(",", row), survey == null ? null : survey.getUri(), properties.getOperator(), new Date(), true);
		} catch (Exception e) {
			logger.warn("Could not enqueue deletion tombstone for {}: {}", Arrays.toString(row), e.getMessage());
		}
	}

	// ---------- Load points from KML ----------

	/**
	 * The placemarks of the KML written as a plots CSV where the page said, which becomes the sample file; the caller
	 * restarts Collect Earth, as the Swing entry did. Answers {@code {csv, plots}}.
	 */
	public Map<String, Object> loadKml(String kmlPath, String csvPath) throws InvalidToolRequestException {
		File kmlFile = new File(StringUtils.trimToEmpty(kmlPath));
		if (StringUtils.isBlank(kmlPath) || !kmlFile.isFile()) {
			throw new InvalidToolRequestException("kml.file", Messages.getString("ToolsPage.kml.noFile"));
		}
		if (StringUtils.isBlank(csvPath)) {
			throw new InvalidToolRequestException("kml.csv", Messages.getString("ToolsPage.kml.noCsv"));
		}
		File csv = new File(csvPath.trim());
		long plots;
		try {
			File extracted = kml.extractPointsToCsv(kmlFile);
			FileUtils.copyFile(extracted, csv);
			plots = Math.max(0, countLines(csv) - 1);
		} catch (Exception e) {
			logger.error("The KML could not be read as plots: " + kmlFile, e);
			throw new InvalidToolRequestException("kml.invalid",
					Messages.getString("ToolsPage.kml.invalid") + ": " + StringUtils.defaultIfBlank(e.getMessage(), e.getClass().getSimpleName()));
		}
		properties.setValue(EarthProperty.SAMPLE_FILE, csv.getAbsolutePath());
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("csv", csv.getAbsolutePath());
		answer.put("plots", plots);
		return answer;
	}

	private static long countLines(File file) throws IOException {
		return FileUtils.readLines(file, "UTF-8").stream().filter(StringUtils::isNotBlank).count();
	}
}

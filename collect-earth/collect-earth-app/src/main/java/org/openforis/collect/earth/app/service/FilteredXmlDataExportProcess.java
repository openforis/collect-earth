package org.openforis.collect.earth.app.service;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.apache.commons.io.IOUtils;
import org.openforis.collect.io.data.DataExportStatus;
import org.openforis.collect.io.data.DataExportStatus.Format;
import org.openforis.collect.io.data.RecordEntry;
import org.openforis.collect.io.data.XMLDataExportProcess;
import org.openforis.collect.manager.RecordFileManager;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.manager.exception.RecordFileException;
import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.RecordFilter;
import org.openforis.collect.persistence.xml.DataMarshaller;
import org.openforis.idm.model.FileAttribute;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Exports the records of the survey to a ZIP file containing the data as XML, selecting the records
 * with a {@link RecordFilter} provided by the caller.
 *
 * Collect's own {@link XMLDataExportProcess} builds its record filter internally and only lets the
 * caller set the summary values, so it cannot filter by the key attributes of the plot. This process
 * produces exactly the same ZIP layout (the idml.xml file, one entry per record named by
 * {@link RecordEntry} and the uploaded files) but takes the whole filter from the caller.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class FilteredXmlDataExportProcess extends AbstractProcess<Void, DataExportStatus> {

	private final Logger logger = LoggerFactory.getLogger(FilteredXmlDataExportProcess.class);

	private final RecordManager recordManager;
	private final RecordFileManager recordFileManager;
	private final SurveyManager surveyManager;
	private final DataMarshaller dataMarshaller;

	private File outputFile;
	private CollectSurvey survey;
	private Step[] steps = new Step[] { Step.ENTRY };
	private boolean includeIdm = true;
	private RecordFilter recordFilter;

	public FilteredXmlDataExportProcess(RecordManager recordManager, RecordFileManager recordFileManager,
			SurveyManager surveyManager, DataMarshaller dataMarshaller) {
		this.recordManager = recordManager;
		this.recordFileManager = recordFileManager;
		this.surveyManager = surveyManager;
		this.dataMarshaller = dataMarshaller;
	}

	@Override
	protected void initStatus() {
		this.status = new DataExportStatus(Format.XML);
	}

	@Override
	public void startProcessing() throws Exception {
		super.startProcessing();
		FileOutputStream fileOutputStream = null;
		BufferedOutputStream bufferedOutputStream = null;
		ZipOutputStream zipOutputStream = null;
		try {
			List<CollectRecordSummary> recordSummaries = recordManager.loadSummaries(recordFilter);
			if (recordSummaries != null && steps != null && steps.length > 0) {
				if (outputFile.exists()) {
					outputFile.delete();
					outputFile.createNewFile();
				}
				fileOutputStream = new FileOutputStream(outputFile);
				bufferedOutputStream = new BufferedOutputStream(fileOutputStream);
				zipOutputStream = new ZipOutputStream(bufferedOutputStream);
				backup(zipOutputStream, recordSummaries);
				zipOutputStream.flush();
			}
		} catch (Exception e) {
			status.error();
			logger.error("Error during data export", e); //$NON-NLS-1$
		} finally {
			IOUtils.closeQuietly(zipOutputStream);
			IOUtils.closeQuietly(bufferedOutputStream);
			IOUtils.closeQuietly(fileOutputStream);
		}
	}

	private void backup(ZipOutputStream zipOutputStream, List<CollectRecordSummary> recordSummaries) {
		status.setTotal(calculateTotal(recordSummaries));
		if (includeIdm) {
			includeIdml(zipOutputStream);
		}
		for (CollectRecordSummary summary : recordSummaries) {
			if (!status.isRunning()) {
				break;
			}
			int recordStepNumber = summary.getStep().getStepNumber();
			for (Step step : steps) {
				int stepNum = step.getStepNumber();
				if (stepNum <= recordStepNumber) {
					backup(zipOutputStream, summary, Step.valueOf(stepNum));
					status.incrementProcessed();
				}
			}
		}
	}

	private int calculateTotal(List<CollectRecordSummary> recordSummaries) {
		int count = 0;
		for (CollectRecordSummary summary : recordSummaries) {
			int recordStepNumber = summary.getStep().getStepNumber();
			for (Step step : steps) {
				if (step.getStepNumber() <= recordStepNumber) {
					count++;
				}
			}
		}
		return count;
	}

	private void includeIdml(ZipOutputStream zipOutputStream) {
		ZipEntry entry = new ZipEntry(XMLDataExportProcess.IDML_FILE_NAME);
		try {
			zipOutputStream.putNextEntry(entry);
			surveyManager.marshalSurvey(survey, zipOutputStream, true, true, false);
			zipOutputStream.closeEntry();
			zipOutputStream.flush();
		} catch (IOException e) {
			String message = "Error while including idml into zip file: " + e.getMessage(); //$NON-NLS-1$
			logger.error(message, e);
			throw new IllegalStateException(message, e);
		}
	}

	private void backup(ZipOutputStream zipOutputStream, CollectRecordSummary summary, Step step) {
		Integer id = summary.getId();
		try {
			CollectRecord record = recordManager.load(survey, id, step, false);
			RecordEntry recordEntry = new RecordEntry(step, id);
			ZipEntry entry = new ZipEntry(recordEntry.getName());
			zipOutputStream.putNextEntry(entry);
			OutputStreamWriter writer = new OutputStreamWriter(zipOutputStream);
			dataMarshaller.write(record, writer);
			zipOutputStream.closeEntry();
			zipOutputStream.flush();
			backupRecordFiles(zipOutputStream, record);
		} catch (Exception e) {
			// Keep exporting the other records, as Collect's own export process does
			logger.error("Error while backing up the record " + id, e); //$NON-NLS-1$
		}
	}

	private void backupRecordFiles(ZipOutputStream zipOutputStream, CollectRecord record) throws RecordFileException {
		List<FileAttribute> fileAttributes = record.getFileAttributes();
		for (FileAttribute fileAttribute : fileAttributes) {
			if (!fileAttribute.isEmpty()) {
				File file = recordFileManager.getRepositoryFile(fileAttribute);
				if (file == null) {
					throw new RecordFileException(String.format("Missing file: %s attributeId: %d attributeName: %s", //$NON-NLS-1$
							fileAttribute.getFilename(), fileAttribute.getInternalId(), fileAttribute.getName()));
				}
				writeFile(zipOutputStream, file, XMLDataExportProcess.calculateRecordFileEntryName(fileAttribute));
			}
		}
	}

	private void writeFile(ZipOutputStream zipOutputStream, File file, String entryName) {
		FileInputStream fileIs = null;
		try {
			ZipEntry entry = new ZipEntry(entryName);
			zipOutputStream.putNextEntry(entry);
			fileIs = new FileInputStream(file);
			IOUtils.copy(fileIs, zipOutputStream);
			zipOutputStream.closeEntry();
			zipOutputStream.flush();
		} catch (IOException e) {
			logger.error(String.format("Error writing record file (fileName: %s)", entryName), e); //$NON-NLS-1$
		} finally {
			IOUtils.closeQuietly(fileIs);
		}
	}

	public void setOutputFile(File outputFile) {
		this.outputFile = outputFile;
	}

	public void setSurvey(CollectSurvey survey) {
		this.survey = survey;
	}

	public void setSteps(Step[] steps) {
		this.steps = steps;
	}

	public void setIncludeIdm(boolean includeIdm) {
		this.includeIdm = includeIdm;
	}

	public RecordFilter getRecordFilter() {
		return recordFilter;
	}

	public void setRecordFilter(RecordFilter recordFilter) {
		this.recordFilter = recordFilter;
	}
}

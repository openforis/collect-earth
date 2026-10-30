package org.openforis.collect.earth.app.service.data;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Observer;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.data.ImportService.ExpiredImportException;
import org.openforis.collect.earth.app.service.data.ProcessJobsTest.RecordingContext;
import org.openforis.collect.io.ReferenceDataImportStatus;
import org.openforis.collect.io.data.CSVDataImportProcess;
import org.openforis.collect.io.data.DataImportState;
import org.openforis.collect.io.data.DataImportSummary;
import org.openforis.collect.io.data.DataImportSummaryItem;
import org.openforis.collect.io.data.XMLDataImportProcess;
import org.openforis.collect.io.metadata.parsing.ParsingError;
import org.openforis.collect.io.metadata.parsing.ParsingError.ErrorType;
import org.openforis.collect.model.CollectRecordSummary;

/** The imports of the Data menu as jobs, over stood-in services. */
public class ImportServiceTest {

	@TempDir
	File folder;

	private final DataImportExportService data = mock(DataImportExportService.class);
	private final EarthSurveyService surveys = mock(EarthSurveyService.class);
	private final AtomicInteger reloads = new AtomicInteger();
	private final AtomicLong clock = new AtomicLong(1_000_000L);
	private final ImportService service = new ImportService(data, surveys, reloads::incrementAndGet, clock::get);
	private File zip;

	@BeforeEach
	public void aZipToImport() throws Exception {
		zip = new File(folder, "data.zip");
		Files.write(zip.toPath(), "not really a zip".getBytes(StandardCharsets.UTF_8));
	}

	/** A summary process of a file with records to import and conflicting ones, reporting its count as it reads. */
	private XMLDataImportProcess summaryProcess(int toImport, int conflicting) throws Exception {
		XMLDataImportProcess process = mock(XMLDataImportProcess.class);
		DataImportState state = new DataImportState();
		when(process.getState()).thenReturn(state);
		DataImportSummary summary = new DataImportSummary();
		List<DataImportSummaryItem> records = new ArrayList<>();
		for (int i = 0; i < toImport; i++) {
			records.add(item(i, 80, null));
		}
		summary.setRecordsToImport(records);
		List<DataImportSummaryItem> conflicts = new ArrayList<>();
		for (int i = 0; i < conflicting; i++) {
			conflicts.add(item(100 + i, 60, 90));
		}
		summary.setConflictingRecords(conflicts);
		when(process.getSummary()).thenReturn(summary);
		org.mockito.Mockito.doAnswer(call -> {
			Observer observer = call.getArgument(0);
			state.setTotal(4);
			for (int i = 0; i < 4; i++) {
				state.incrementCount();
				observer.update(state, null);
			}
			return null;
		}).when(process).callAndObserve(any());
		return process;
	}

	private static DataImportSummaryItem item(int entryId, int completion, Integer existingCompletion) {
		CollectRecordSummary record = mock(CollectRecordSummary.class);
		when(record.getRootEntityKeyValues()).thenReturn(Arrays.asList("plot_" + entryId));
		when(record.getModifiedDate()).thenReturn(new Date(1700000000000L + entryId));
		when(record.getCompletionPercent()).thenReturn(completion);
		CollectRecordSummary existing = null;
		if (existingCompletion != null) {
			existing = mock(CollectRecordSummary.class);
			when(existing.getModifiedDate()).thenReturn(new Date(1600000000000L));
			when(existing.getCompletionPercent()).thenReturn(existingCompletion);
		}
		return new DataImportSummaryItem(entryId, record, Collections.emptyList(), existing);
	}

	@Test
	public void theCsvInfoIsTheKeyAttributes() {
		when(surveys.getKeyNamesForSurvey()).thenReturn(new String[] { "id", "plot_no" });
		assertEquals(Arrays.asList("id", "plot_no"), service.csvInfo().get("keyAttributes"));
		when(surveys.getKeyNamesForSurvey()).thenReturn(null);
		assertEquals(Collections.emptyList(), service.csvInfo().get("keyAttributes"));
	}

	@Test
	@SuppressWarnings("unchecked")
	public void theSummariesSayWhatEachFileHoldsAndKeepTheProcesses() throws Exception {
		XMLDataImportProcess process = summaryProcess(2, 1);
		when(data.getImportSummary(zip, false)).thenReturn(process);
		RecordingContext context = new RecordingContext();
		Map<String, Object> result = (Map<String, Object>) service.summaries(Collections.singletonList(zip.getPath()), false).run(context);
		assertNotNull(result.get("token"));
		List<Map<String, Object>> files = (List<Map<String, Object>>) result.get("files");
		assertEquals(1, files.size());
		assertEquals("data.zip", files.get(0).get("name"));
		assertEquals(zip.getAbsolutePath(), files.get(0).get("path"));
		assertEquals(2, files.get(0).get("toImport"));
		List<Map<String, Object>> conflicts = (List<Map<String, Object>>) files.get(0).get("conflicts");
		assertEquals(1, conflicts.size());
		assertEquals(Arrays.asList("plot_100"), conflicts.get(0).get("keys"));
		assertEquals(1700000000100L, conflicts.get(0).get("modified"));
		assertEquals(60, conflicts.get(0).get("completion"));
		assertEquals(1600000000000L, conflicts.get(0).get("existingModified"));
		assertEquals(90, conflicts.get(0).get("existingCompletion"));
		assertEquals(Collections.emptyList(), files.get(0).get("errors"));
		// The reading was reported as it went
		assertTrue(context.progress.contains("50 " + org.openforis.collect.earth.app.view.Messages.getString("ImportDialogProcessMonitor.2") + " 2/4"));
		assertEquals(1, service.preparedCount());
		assertEquals(0, reloads.get());
	}

	@Test
	@SuppressWarnings("unchecked")
	public void aFileThatCannotBeReadHasItsErrorsAndTheOthersGoOn() throws Exception {
		File broken = new File(folder, "broken.zip");
		Files.write(broken.toPath(), "x".getBytes(StandardCharsets.UTF_8));
		XMLDataImportProcess readable = summaryProcess(1, 0);
		when(data.getImportSummary(broken, true)).thenThrow(new IllegalStateException("not a zip"));
		when(data.getImportSummary(zip, true)).thenReturn(readable);
		Map<String, Object> result = (Map<String, Object>) service.summaries(Arrays.asList(broken.getPath(), zip.getPath(), new File(folder, "missing.zip").getPath()), true)
				.run(new RecordingContext());
		List<Map<String, Object>> files = (List<Map<String, Object>>) result.get("files");
		assertEquals(3, files.size());
		assertTrue(((List<String>) files.get(0).get("errors")).get(0).endsWith("not a zip"));
		assertEquals(0, files.get(0).get("toImport"));
		assertEquals(1, files.get(1).get("toImport"));
		assertEquals(1, ((List<String>) files.get(2).get("errors")).size());
		assertNotNull(result.get("token"));
		// Nothing readable: no token
		Map<String, Object> none = (Map<String, Object>) service.summaries(Collections.singletonList(broken.getPath()), true).run(new RecordingContext());
		assertNull(none.get("token"));
	}

	@Test
	@SuppressWarnings("unchecked")
	public void thePreparedImportImportsWithTheAnswersAndReloadsThePlots() throws Exception {
		XMLDataImportProcess process = summaryProcess(2, 1);
		when(data.getImportSummary(zip, false)).thenReturn(process);
		Map<String, Object> summaries = (Map<String, Object>) service.summaries(Collections.singletonList(zip.getPath()), false).run(new RecordingContext());
		String token = (String) summaries.get("token");
		RecordingContext context = new RecordingContext();
		List<DataImportSummaryItem> conflicts = process.getSummary().getConflictingRecords();
		Map<String, Object> result = (Map<String, Object>) service.importPrepared(token, Collections.singletonList(zip.getAbsolutePath())).run(context);
		verify(data).importRecordsFrom(eq(zip), eq(process), eq(conflicts));
		assertEquals(3, result.get("imported"));
		assertEquals(1, result.get("overwritten"));
		assertEquals(1, reloads.get());
		verify(process).close();
		assertEquals(0, service.preparedCount());
		assertTrue(context.messages.get(0).startsWith("data.zip: "));
		// The token is gone
		assertThrows(ExpiredImportException.class, () -> service.importPrepared(token, Collections.emptyList()));
		assertThrows(ExpiredImportException.class, () -> service.importPrepared(null, Collections.emptyList()));
	}

	@Test
	@SuppressWarnings("unchecked")
	public void withoutTheAnswerToOverwriteTheConflictingRecordsAreLeftOut() throws Exception {
		XMLDataImportProcess process = summaryProcess(2, 1);
		when(data.getImportSummary(zip, false)).thenReturn(process);
		String token = (String) ((Map<String, Object>) service.summaries(Collections.singletonList(zip.getPath()), false).run(new RecordingContext())).get("token");
		Map<String, Object> result = (Map<String, Object>) service.importPrepared(token, Collections.emptyList()).run(new RecordingContext());
		verify(data).importRecordsFrom(eq(zip), eq(process), eq(Collections.emptyList()));
		assertEquals(2, result.get("imported"));
		assertEquals(0, result.get("overwritten"));
	}

	@Test
	@SuppressWarnings("unchecked")
	public void aPreparedImportIsForgottenAfterAWhile() throws Exception {
		XMLDataImportProcess process = summaryProcess(1, 0);
		when(data.getImportSummary(zip, false)).thenReturn(process);
		String token = (String) ((Map<String, Object>) service.summaries(Collections.singletonList(zip.getPath()), false).run(new RecordingContext())).get("token");
		clock.addAndGet(ImportService.FORGET_AFTER_MINUTES * 60_000L + 1);
		assertThrows(ExpiredImportException.class, () -> service.importPrepared(token, Collections.emptyList()));
		assertEquals(0, service.preparedCount());
		assertEquals(0, reloads.get());
	}

	/** A CSV update process: init() leaves the status as told, call() updates this many rows */
	private CSVDataImportProcess csvProcess(File file, List<ParsingError> errorsAtInit, long updated) throws Exception {
		CSVDataImportProcess process = mock(CSVDataImportProcess.class);
		ReferenceDataImportStatus<ParsingError> status = new ReferenceDataImportStatus<>();
		when(process.getStatus()).thenReturn(status);
		org.mockito.Mockito.doAnswer(call -> {
			for (ParsingError error : errorsAtInit) {
				status.addParsingError(error);
			}
			if (!errorsAtInit.isEmpty()) {
				status.setErrorMessage("Wrong columns");
				status.error();
			}
			return null;
		}).when(process).init();
		when(process.call()).thenAnswer(call -> {
			status.start();
			for (long i = 0; i < updated; i++) {
				status.incrementProcessed();
			}
			status.complete();
			return null;
		});
		when(data.getCsvImporterProcess(file)).thenReturn(process);
		return process;
	}

	@Test
	@SuppressWarnings("unchecked")
	public void theCsvUpdateRunsEachFileAndReportsItsRows() throws Exception {
		File good = new File(folder, "good.csv");
		Files.write(good.toPath(), Arrays.asList("id,land_use", "1,forest", "2,crop"), StandardCharsets.UTF_8);
		File bad = new File(folder, "bad.csv");
		Files.write(bad.toPath(), Arrays.asList("x,y", "1,2"), StandardCharsets.UTF_8);
		CSVDataImportProcess goodProcess = csvProcess(good, Collections.emptyList(), 2);
		CSVDataImportProcess badProcess = csvProcess(bad, Collections.singletonList(new ParsingError(ErrorType.MISSING_REQUIRED_COLUMNS, 1, "id", "missing")), 0);
		RecordingContext context = new RecordingContext();
		Map<String, Object> result = (Map<String, Object>) service.updateFromCsv(Arrays.asList(good.getPath(), bad.getPath())).run(context);
		List<Map<String, Object>> files = (List<Map<String, Object>>) result.get("files");
		assertEquals(2, files.size());
		assertEquals(2L, files.get(0).get("updated"));
		assertEquals(Collections.emptyList(), files.get(0).get("errors"));
		// The total was the lines of the file, so the progress could be a percentage
		assertEquals(3L, goodProcess.getStatus().getTotal());
		assertEquals(0L, files.get(1).get("updated"));
		List<String> errors = (List<String>) files.get(1).get("errors");
		assertEquals("Wrong columns", errors.get(0));
		assertTrue(errors.get(1).contains("MISSING_REQUIRED_COLUMNS"));
		verify(badProcess, never()).call();
		assertTrue(context.messages.get(0).startsWith("bad.csv - Wrong columns"));
	}

	@Test
	@SuppressWarnings("unchecked")
	public void aCsvFileThatFailsWhileUpdatingIsReportedAndTheNextOneRuns() throws Exception {
		File first = new File(folder, "first.csv");
		Files.write(first.toPath(), Arrays.asList("id,land_use", "1,forest"), StandardCharsets.UTF_8);
		File second = new File(folder, "second.csv");
		Files.write(second.toPath(), Arrays.asList("id,land_use", "1,forest"), StandardCharsets.UTF_8);
		CSVDataImportProcess failing = mock(CSVDataImportProcess.class);
		ReferenceDataImportStatus<ParsingError> status = new ReferenceDataImportStatus<>();
		when(failing.getStatus()).thenReturn(status);
		when(failing.call()).thenAnswer(call -> {
			status.addParsingError(new ParsingError(ErrorType.INVALID_VALUE, 2, "land_use", "no such code"));
			status.setErrorMessage("2 rows could not be updated");
			status.error();
			return null;
		});
		when(data.getCsvImporterProcess(first)).thenReturn(failing);
		csvProcess(second, Collections.emptyList(), 1);
		Map<String, Object> result = (Map<String, Object>) service.updateFromCsv(Arrays.asList(first.getPath(), second.getPath())).run(new RecordingContext());
		List<Map<String, Object>> files = (List<Map<String, Object>>) result.get("files");
		List<String> errors = (List<String>) files.get(0).get("errors");
		assertEquals("2 rows could not be updated", errors.get(0));
		assertTrue(errors.get(1).contains("no such code"));
		assertEquals(1L, files.get(1).get("updated"));
		verify(data, never()).getImportSummary(any(), anyBoolean());
	}
}

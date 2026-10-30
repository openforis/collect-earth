package org.openforis.collect.earth.app.service.data;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.data.ExportRequest.Format;
import org.openforis.collect.earth.app.service.data.ExportRequest.Records;
import org.openforis.collect.earth.app.service.data.ExportService.InvalidExportException;
import org.openforis.collect.earth.app.service.data.ProcessJobsTest.RecordingContext;
import org.openforis.collect.io.data.CSVDataExportProcess;
import org.openforis.collect.io.data.DataExportStatus;
import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.Schema;

/** The exports of the Data menu as a job, over stood-in services. */
public class ExportServiceTest {

	private final DataImportExportService data = mock(DataImportExportService.class);
	private final EarthSurveyService surveys = mock(EarthSurveyService.class);
	private final KmlGeneratorService kml = mock(KmlGeneratorService.class);
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	/** 2026-10-30 15:30:00, in the time zone the file names are written in */
	private final Date now = at(2026, 10, 30, 15, 30);
	private final ExportService service = new ExportService(data, surveys, kml, properties, () -> now);
	private final CollectSurvey survey = mock(CollectSurvey.class);

	@BeforeEach
	public void aSurveyWithAKeyAndTwoSummaryAttributes() {
		when(surveys.getCollectSurvey()).thenReturn(survey);
		when(survey.getName()).thenReturn("nfi_2026");
		// The mocks of the attributes are made before the stubbing that lists them: a mock made inside a when() is an
		// unfinished stubbing for Mockito
		List<AttributeDefinition> keys = Collections.singletonList(attribute("id", "Plot id"));
		List<AttributeDefinition> summaries = Arrays.asList(attribute("region", "Region"), attribute("operator", "Operator"));
		EntityDefinition root = mock(EntityDefinition.class);
		when(surveys.getRootEntityDefinition()).thenReturn(root);
		when(root.getKeyAttributeDefinitions()).thenReturn(keys);
		Schema schema = mock(Schema.class);
		when(survey.getSchema()).thenReturn(schema);
		when(schema.getSummaryAttributeDefinitions(root)).thenReturn(summaries);
		when(properties.getUiLanguage()).thenReturn(UI_LANGUAGE.EN);
		when(properties.getOperator()).thenReturn("Álvaro S.");
	}

	private static Date at(int year, int month, int day, int hour, int minute) {
		return Date.from(LocalDateTime.of(year, month, day, hour, minute).atZone(ZoneId.systemDefault()).toInstant());
	}

	private static AttributeDefinition attribute(String name, String label) {
		AttributeDefinition definition = mock(AttributeDefinition.class);
		when(definition.getName()).thenReturn(name);
		when(definition.getFailSafeLabel("en")).thenReturn(label);
		return definition;
	}

	private static ExportRequest request(Format format, Records records, String path) {
		ExportRequest request = new ExportRequest();
		request.format = format;
		request.records = records;
		request.path = path;
		return request;
	}

	@Test
	@SuppressWarnings("unchecked")
	public void theOptionsAreTheFormatsTheAttributesAndTheLastExport() {
		Map<String, Object> options = service.options();
		assertEquals(Arrays.asList("CSV", "XML", "BACKUP", "KML"), options.get("formats"));
		List<Map<String, Object>> attributes = (List<Map<String, Object>>) options.get("attributes");
		assertEquals(3, attributes.size());
		assertEquals("KEY:0", attributes.get(0).get("id"));
		assertEquals("Plot id (key)", attributes.get(0).get("label"));
		assertEquals("SUMMARY:1", attributes.get(2).get("id"));
		assertEquals("Operator (summary)", attributes.get(2).get("label"));
		assertNull(options.get("lastExport"));
		assertEquals("nfi_2026", options.get("survey"));
		when(properties.getLastExportedDate("nfi_2026")).thenReturn(new Date(1700000000000L));
		assertEquals(1700000000000L, service.options().get("lastExport"));
	}

	@Test
	public void onlyTheFirstThreeOfEachKindCanFilter() {
		List<AttributeDefinition> four = Arrays.asList(attribute("a", "A"), attribute("b", "B"), attribute("c", "C"), attribute("d", "D"));
		EntityDefinition root = surveys.getRootEntityDefinition();
		when(root.getKeyAttributeDefinitions()).thenReturn(four);
		assertEquals(5, service.attributes().size());
		assertEquals("KEY:2", service.attributes().get(2).getId());
		when(surveys.getCollectSurvey()).thenReturn(null);
		assertTrue(service.attributes().isEmpty());
	}

	@Test
	public void theFileNameIsTheSwingOne() throws Exception {
		assertEquals("AlvaroS_collectedData_nfi_2026_on_301026_153000_ZIP_WITH_XML.zip", service.fileName(request(Format.XML, Records.ALL, null)));
		assertEquals("AlvaroS_collectedData_nfi_2026_on_301026_153000_CSV.csv", service.fileName(request(Format.CSV, Records.ALL, null)));
		assertEquals("AlvaroS_collectedData_nfi_2026_on_301026_153000_COLLECT_BACKUP.collect-data", service.fileName(request(Format.BACKUP, Records.ALL, null)));
		assertEquals("AlvaroS_collectedData_nfi_2026_on_301026_153000_KML_FILE.kml", service.fileName(request(Format.KML, Records.ALL, null)));
		ExportRequest fromDate = request(Format.XML, Records.FROM_DATE, null);
		fromDate.fromDate = "2026-10-01";
		assertEquals("AlvaroS_collectedData_nfi_2026_011026_000000_to_301026_153000_ZIP_WITH_XML.zip", service.fileName(fromDate));
		ExportRequest byAttribute = request(Format.XML, Records.BY_ATTRIBUTE, null);
		byAttribute.attribute = "SUMMARY:0";
		byAttribute.value = "Nord-Est*";
		assertEquals("AlvaroS_collectedData_nfi_2026_region_NordEst_on_301026_153000_ZIP_WITH_XML.zip", service.fileName(byAttribute));
		// Since the last export, and without one every record is exported, which the name says as "on"
		ExportRequest since = request(Format.XML, Records.SINCE_LAST_EXPORT, null);
		assertEquals("AlvaroS_collectedData_nfi_2026_on_301026_153000_ZIP_WITH_XML.zip", service.fileName(since));
		when(properties.getLastExportedDate("nfi_2026")).thenReturn(at(2026, 10, 29, 9, 5));
		assertEquals("AlvaroS_collectedData_nfi_2026_291026_090500_to_301026_153000_ZIP_WITH_XML.zip", service.fileName(since));
	}

	@Test
	public void aRequestThatCannotBeExportedIsRefusedBeforeTheJob() {
		assertEquals("export.path", refused(request(Format.XML, Records.ALL, " ")));
		assertEquals("export.records", refused(request(Format.KML, Records.FROM_DATE, "/tmp/x.kml")));
		assertEquals("export.records", refused(request(Format.CSV, Records.BY_ATTRIBUTE, "/tmp/x.csv")));
		ExportRequest badDate = request(Format.BACKUP, Records.FROM_DATE, "/tmp/x.collect-data");
		badDate.fromDate = "yesterday";
		assertEquals("export.date", refused(badDate));
		ExportRequest noValue = request(Format.XML, Records.BY_ATTRIBUTE, "/tmp/x.zip");
		noValue.attribute = "KEY:0";
		assertEquals("export.value", refused(noValue));
		noValue.attribute = "KEY:7";
		noValue.value = "x";
		assertEquals("export.attribute", refused(noValue));
		when(surveys.getCollectSurvey()).thenReturn(null);
		assertEquals("export.noSurvey", refused(request(Format.XML, Records.ALL, "/tmp/x.zip")));
	}

	private String refused(ExportRequest request) {
		return assertThrows(InvalidExportException.class, () -> service.export(request)).getCode();
	}

	/** A process whose call completes its status with this many records */
	private static <P extends AbstractProcess<Void, DataExportStatus>> P completing(P process, long records) throws Exception {
		DataExportStatus status = mock(DataExportStatus.class);
		when(status.getTotal()).thenReturn(records);
		when(process.getStatus()).thenReturn(status);
		when(process.call()).thenAnswer(call -> {
			when(status.getProcessed()).thenReturn(records);
			when(status.getProgressPercent()).thenReturn(100);
			when(status.isComplete()).thenReturn(true);
			return null;
		});
		return process;
	}

	@Test
	public void aCsvExportRunsTheProcessAndAnswersTheFile() throws Exception {
		CSVDataExportProcess process = completing(mock(CSVDataExportProcess.class), 12);
		when(data.exportSurveyAsCsv(any(File.class), eq(true))).thenReturn(process);
		ExportRequest request = request(Format.CSV, Records.ALL, "/tmp/export.csv");
		request.includeLabels = true;
		RecordingContext context = new RecordingContext();
		Map<?, ?> result = (Map<?, ?>) service.export(request).run(context);
		assertEquals(new File("/tmp/export.csv").getAbsolutePath(), result.get("path"));
		assertEquals(12L, result.get("records"));
		assertEquals("100 " + org.openforis.collect.earth.app.view.Messages.getString("ExportDialogProcessMonitor.4") + " 12/12",
				context.progress.get(context.progress.size() - 1));
		verify(properties, never()).setLastExportedDate(any());
	}

	@Test
	@SuppressWarnings("unchecked")
	public void anXmlExportSinceTheLastExportRecordsThisOneAsTheLast() throws Exception {
		AbstractProcess<Void, DataExportStatus> process = completing(mock(AbstractProcess.class), 3);
		when(properties.getLastExportedDate("nfi_2026")).thenReturn(new Date(1700000000000L));
		when(data.exportSurveyAsZipWithXml(any(File.class), eq(new Date(1700000000000L)), isNull(), isNull())).thenReturn(process);
		service.export(request(Format.XML, Records.SINCE_LAST_EXPORT, "/tmp/export.zip")).run(new RecordingContext());
		verify(properties).setLastExportedDate("nfi_2026");
	}

	@Test
	@SuppressWarnings("unchecked")
	public void anExportByAttributePassesThePositionedValues() throws Exception {
		AbstractProcess<Void, DataExportStatus> process = completing(mock(AbstractProcess.class), 1);
		when(data.exportSurveyAsZipWithXml(any(File.class), any(), any(), any())).thenReturn(process);
		ExportRequest request = request(Format.XML, Records.BY_ATTRIBUTE, "/tmp/export.zip");
		request.attribute = "SUMMARY:1";
		request.value = " AB* ";
		service.export(request).run(new RecordingContext());
		verify(data).exportSurveyAsZipWithXml(any(File.class), isNull(), isNull(), eq(Arrays.asList("", "AB*")));
		request.attribute = "KEY:0";
		service.export(request).run(new RecordingContext());
		verify(data).exportSurveyAsZipWithXml(any(File.class), isNull(), eq(Collections.singletonList("AB*")), isNull());
		verify(properties, never()).setLastExportedDate(any());
	}

	@Test
	public void theKmlExportIsTheGeneratorsWithoutProgress() throws Exception {
		Map<?, ?> result = (Map<?, ?>) service.export(request(Format.KML, Records.ALL, "/tmp/plots.kml")).run(new RecordingContext());
		verify(kml).exportToKml(new File("/tmp/plots.kml"));
		assertEquals(0L, result.get("records"));
		verify(data, never()).exportSurveyAsCsv(any(), anyBoolean());
	}
}

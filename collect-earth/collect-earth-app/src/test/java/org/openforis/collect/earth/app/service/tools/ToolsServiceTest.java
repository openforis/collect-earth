package org.openforis.collect.earth.app.service.tools;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.KmlImportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.MissingPlotService;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao;
import org.openforis.collect.earth.app.service.jobs.RecordingContext;
import org.openforis.collect.earth.app.service.tools.ToolsService.DivideCsvRequest;
import org.openforis.collect.earth.app.service.tools.ToolsService.InvalidToolRequestException;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.Schema;

/** The utilities of the Tools menu as jobs and calls, over stood-in services. */
public class ToolsServiceTest {

	@TempDir
	File folder;

	private final MissingPlotService missing = mock(MissingPlotService.class);
	private final EarthSurveyService surveys = mock(EarthSurveyService.class);
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final RecordManager records = mock(RecordManager.class);
	private final CloudSyncQueueDao cloudQueue = mock(CloudSyncQueueDao.class);
	private final KmlImportService kml = mock(KmlImportService.class);
	private final AtomicInteger reloads = new AtomicInteger();
	private DivideCsvRequest divided;
	private final ToolsService service = new ToolsService(missing, surveys, properties, records, cloudQueue, kml, (survey, request) -> {
		divided = request;
		return new File(request.folder, "div_" + request.files);
	}, survey -> Arrays.asList("id", "YCoordinate", "XCoordinate", "region"), reloads::incrementAndGet);
	private final CollectSurvey survey = mock(CollectSurvey.class);

	@BeforeEach
	public void aSurveyWithOneKey() {
		when(surveys.getCollectSurvey()).thenReturn(survey);
		when(survey.getUri()).thenReturn("http://survey/nfi");
		AttributeDefinition id = mock(AttributeDefinition.class);
		when(id.getName()).thenReturn("id");
		List<AttributeDefinition> keys = Collections.singletonList(id);
		EntityDefinition root = mock(EntityDefinition.class);
		when(root.getKeyAttributeDefinitions()).thenReturn(keys);
		Schema schema = mock(Schema.class);
		when(schema.getRootEntityDefinitions()).thenReturn(Collections.singletonList(root));
		when(survey.getSchema()).thenReturn(schema);
	}

	private File csv(String name, String... lines) throws Exception {
		File file = new File(folder, name);
		Files.write(file.toPath(), Arrays.asList(lines), StandardCharsets.UTF_8);
		return file;
	}

	@Test
	@SuppressWarnings("unchecked")
	public void theMissingPlotsAreReportedPerFile() throws Exception {
		File plots = csv("plots.csv", "1,41.5,2.1", "2,41.6,2.2", "3,41.7,2.3");
		Map<String, List<String[]>> all = new LinkedHashMap<>();
		all.put(plots.getAbsolutePath(), Arrays.asList(new String[] { "1" }, new String[] { "2" }, new String[] { "3" }));
		Map<String, List<String[]>> missingRows = new LinkedHashMap<>();
		missingRows.put(plots.getAbsolutePath(), Collections.singletonList(new String[] { "2", "41.6", "2.2" }));
		when(missing.getPlotDataByFile(any())).thenReturn(all);
		when(missing.getMissingPlotsByFile(eq(all), any())).thenReturn(missingRows);
		when(missing.getMissingPlotInformation(all, missingRows)).thenReturn("Number of missing plots : 1");
		File temp = csv("missing.csv", "2,41.6,2.2");
		when(missing.getMissingPlotFile(missingRows)).thenReturn(temp);
		RecordingContext context = new RecordingContext();
		Map<String, Object> result = (Map<String, Object>) service.missingPlots(Collections.singletonList(plots.getPath())).run(context);
		assertEquals("Number of missing plots : 1", result.get("text"));
		assertEquals(3, result.get("totalPlots"));
		assertEquals(1, result.get("totalMissing"));
		List<Map<String, Object>> files = (List<Map<String, Object>>) result.get("files");
		assertEquals("plots.csv", files.get(0).get("name"));
		assertEquals(Arrays.asList(Arrays.asList("2", "41.6", "2.2")), files.get(0).get("missing"));
		assertEquals(temp.getAbsolutePath(), result.get("csv"));
		assertTrue(context.progress.get(0).contains(Messages.getString("MissingPlotsListener.1")));
	}

	@Test
	public void theMissingPlotsNeedFilesThatExist() {
		assertEquals("files.none", assertThrows(InvalidToolRequestException.class, () -> service.missingPlots(Collections.emptyList())).getCode());
		assertEquals("files.missing",
				assertThrows(InvalidToolRequestException.class, () -> service.missingPlots(Collections.singletonList(new File(folder, "x.csv").getPath()))).getCode());
	}

	@Test
	@SuppressWarnings("unchecked")
	public void theCsvIsDividedIntoAFolder() throws Exception {
		File source = csv("plots.csv", "id,YCoordinate,XCoordinate,region", "1,41.5,2.1,N", "2,41.6,2.2,S");
		assertEquals(Arrays.asList("id", "YCoordinate", "XCoordinate", "region"), service.divideCsvColumns());
		DivideCsvRequest request = new DivideCsvRequest();
		request.source = source.getPath();
		request.folder = folder.getPath();
		request.files = 2;
		request.randomize = true;
		request.column = 3;
		Map<String, Object> result = (Map<String, Object>) service.divideCsv(request).run(new RecordingContext());
		assertEquals(new File(folder, "div_2").getAbsolutePath(), result.get("path"));
		assertEquals(2, divided.files);
		assertEquals(3, divided.column);
		assertTrue(divided.randomize);
		// Without a survey, no columns to stratify by
		when(surveys.getCollectSurvey()).thenReturn(null);
		assertEquals(Collections.emptyList(), service.divideCsvColumns());
	}

	@Test
	public void theDivisionNeedsAFileAFolderAndACount() throws Exception {
		File source = csv("plots.csv", "1,41.5,2.1");
		DivideCsvRequest request = new DivideCsvRequest();
		assertEquals("divide.source", assertThrows(InvalidToolRequestException.class, () -> service.divideCsv(request)).getCode());
		request.source = source.getPath();
		request.folder = new File(folder, "nowhere").getPath();
		assertEquals("divide.folder", assertThrows(InvalidToolRequestException.class, () -> service.divideCsv(request)).getCode());
		request.folder = folder.getPath();
		request.files = 0;
		assertEquals("divide.files", assertThrows(InvalidToolRequestException.class, () -> service.divideCsv(request)).getCode());
		request.files = ToolsService.MAX_FILES_TO_DIVIDE_INTO + 1;
		assertEquals("divide.files", assertThrows(InvalidToolRequestException.class, () -> service.divideCsv(request)).getCode());
	}

	@Test
	public void theCsvOfPlotsToDeleteMustHaveTheKeyAttributesAsItsHeader() throws Exception {
		File good = csv("delete.csv", "id", "1", "2");
		Map<String, Object> ok = service.deletePlotsCheck(good.getPath());
		assertEquals(true, ok.get("ok"));
		assertEquals(Collections.singletonList("id"), ok.get("expected"));
		assertEquals(Collections.singletonList("id"), ok.get("found"));
		assertNull(ok.get("message"));
		File wrong = csv("wrong.csv", "plot_id", "1");
		Map<String, Object> bad = service.deletePlotsCheck(wrong.getPath());
		assertEquals(false, bad.get("ok"));
		assertEquals(Collections.singletonList("plot_id"), bad.get("found"));
		assertTrue(((String) bad.get("message")).contains("[plot_id]"));
		assertEquals(false, service.deletePlotsCheck(new File(folder, "none.csv").getPath()).get("ok"));
		assertEquals(false, service.deletePlotsCheck(" ").get("ok"));
		assertEquals("delete.csv", assertThrows(InvalidToolRequestException.class, () -> service.deletePlots(wrong.getPath())).getCode());
	}

	@Test
	@SuppressWarnings("unchecked")
	public void thePlotsAreDeletedWithTheirOutcomesLogged() throws Exception {
		File file = csv("delete.csv", "id", "1", "2", "3");
		CollectRecord one = mock(CollectRecord.class);
		when(one.getId()).thenReturn(11);
		CollectRecord three = mock(CollectRecord.class);
		when(three.getId()).thenReturn(33);
		when(surveys.loadRecord(new String[] { "1" })).thenReturn(one);
		when(surveys.loadRecord(new String[] { "2" })).thenReturn(null);
		when(surveys.loadRecord(new String[] { "3" })).thenReturn(three);
		doThrow(new RuntimeException("locked")).when(records).delete(33);
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getOperator()).thenReturn("alfonso");
		RecordingContext context = new RecordingContext();
		Map<String, Object> result = (Map<String, Object>) service.deletePlots(file.getPath()).run(context);
		assertEquals(1, result.get("deleted"));
		assertEquals(1, result.get("notFound"));
		assertEquals(1, result.get("failed"));
		verify(records).delete(11);
		verify(cloudQueue).enqueue(eq("1"), eq("http://survey/nfi"), eq("alfonso"), any(), eq(true));
		verify(cloudQueue, never()).enqueue(eq("3"), anyString(), anyString(), any(), eq(true));
		// The step first, then a line per row
		assertEquals(4, context.messages.size());
		assertTrue(context.messages.get(2).contains("[2]"));
		assertTrue(context.messages.get(3).contains("locked"));
		assertEquals(1, reloads.get());
		assertTrue(context.progress.get(context.progress.size() - 1).startsWith("100 "));
	}

	@Test
	@SuppressWarnings("unchecked")
	public void nothingDeletedReloadsNothing() throws Exception {
		File file = csv("delete.csv", "id", "9");
		when(surveys.loadRecord(any())).thenReturn(null);
		Map<String, Object> result = (Map<String, Object>) service.deletePlots(file.getPath()).run(new RecordingContext());
		assertEquals(0, result.get("deleted"));
		assertEquals(0, reloads.get());
		verify(records, never()).delete(anyInt());
	}

	@Test
	public void theKmlBecomesTheSampleFile() throws Exception {
		File kmlFile = csv("points.kml", "<kml/>");
		File extracted = csv("extracted.csv", "id,YCoordinate,XCoordinate", "p_1,41.5,2.1", "p_2,41.6,2.2");
		when(kml.extractPointsToCsv(kmlFile)).thenReturn(extracted);
		File csv = new File(folder, "importedFromKml_points.kml.csv");
		Map<String, Object> answer = service.loadKml(kmlFile.getPath(), csv.getPath());
		assertEquals(csv.getAbsolutePath(), answer.get("csv"));
		assertEquals(2L, answer.get("plots"));
		assertEquals(new ArrayList<>(Files.readAllLines(extracted.toPath())), new ArrayList<>(Files.readAllLines(csv.toPath())));
		verify(properties).setValue(EarthProperty.SAMPLE_FILE, csv.getAbsolutePath());
	}

	@Test
	public void aKmlThatCannotBeReadIsRefusedAndNothingChanges() throws Exception {
		File kmlFile = csv("bad.kml", "not xml");
		when(kml.extractPointsToCsv(kmlFile)).thenThrow(new IllegalStateException("no placemarks"));
		InvalidToolRequestException refused = assertThrows(InvalidToolRequestException.class,
				() -> service.loadKml(kmlFile.getPath(), new File(folder, "out.csv").getPath()));
		assertEquals("kml.invalid", refused.getCode());
		assertTrue(refused.getMessage().endsWith("no placemarks"));
		verify(properties, never()).setValue(any(), any());
		assertEquals("kml.file", assertThrows(InvalidToolRequestException.class, () -> service.loadKml(new File(folder, "x.kml").getPath(), "o.csv")).getCode());
		assertEquals("kml.csv", assertThrows(InvalidToolRequestException.class, () -> service.loadKml(kmlFile.getPath(), " ")).getCode());
	}
}

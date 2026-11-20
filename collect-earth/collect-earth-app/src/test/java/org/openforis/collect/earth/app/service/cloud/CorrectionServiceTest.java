package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.CloudApiException;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.Destination;
import org.openforis.collect.earth.app.service.cloud.CorrectionService.CorrectionLoadResult;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.core.model.PlacemarkInputFieldInfo;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
import org.openforis.collect.model.CollectRecord;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Correcting plots others answered (docs/plans/2026-11-20-review-at-scale.md, part C). */
public class CorrectionServiceTest {

	@TempDir
	File folder;

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final CloudApiClient api = mock(CloudApiClient.class);
	private final AbstractEarthSurveyService surveys = mock(AbstractEarthSurveyService.class);
	private final NoticeService notices = new NoticeService();
	private final AtomicInteger reloads = new AtomicInteger();
	private final Map<EarthProperty, String> values = new HashMap<>();
	private final Destination cloud = new Destination("https://cloud", "p1", "t");
	private final ObjectMapper json = new ObjectMapper();
	private MyPlotsService myPlots;
	private CorrectionService service;
	private File myCopy;

	@BeforeEach
	public void setUp() throws IOException {
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudSyncToken()).thenReturn("t");
		when(properties.getCloudProjectId()).thenReturn("p1");
		when(properties.getValue(any(EarthProperty.class))).thenAnswer(i -> values.getOrDefault(i.getArgument(0), ""));
		doAnswer(i -> values.put(i.getArgument(0), i.getArgument(1))).when(properties).setValue(any(), any());
		when(api.cloudDestination()).thenReturn(cloud);
		File root = new File(folder, "cloud");
		myPlots = new MyPlotsService(properties, api, notices, () -> { }, root);
		service = new CorrectionService(properties, api, surveys, myPlots, notices, reloads::incrementAndGet, root);
		// the person's own plots, the plots file
		myCopy = new File(new File(root, "p1"), MyPlotsService.COPY);
		myCopy.getParentFile().mkdirs();
		Files.write(myCopy.toPath(), "id,round,lat,lon\n9,1,1,1\n".getBytes(StandardCharsets.UTF_8));
		values.put(EarthProperty.SAMPLE_FILE, myCopy.getAbsolutePath());
	}

	/** The server's plots to correct, of a version: each as plot unit and placemark id, its first answer ana's */
	private void server(String version, String... plots) throws IOException {
		StringBuilder list = new StringBuilder("[");
		for (int i = 0; i < plots.length; i++) {
			String plot = plots[i];
			list.append(i == 0 ? "" : ",").append("{\"plot\":\"").append(plot).append("\",\"placemarkId\":\"").append(plot).append(",1\",")
					.append("\"comment\":\"look at the trees\",\"decidedBy\":\"owner\",\"decidedAt\":1,\"own\":false,\"correctedAt\":null,")
					.append("\"answers\":[{\"operator\":\"ana\",\"recordKey\":\"").append(plot).append(",1\",\"assessment\":\"main\",\"submitted\":true,")
					.append("\"modifiedOn\":1,\"xml\":\"<plot>ana</plot>\",\"summary\":{}}],\"differences\":[]}");
		}
		list.append("]");
		JsonNode answer = json.readTree("{\"version\":\"" + version + "\",\"keyColumns\":2,\"downloadPath\":\"/v1/projects/p1/my-corrections.csv?v=" + version
				+ "\",\"plots\":" + list + "}");
		when(api.myCorrections(cloud)).thenReturn(answer);
		doAnswer(i -> {
			StringBuilder csv = new StringBuilder("id,round,lat,lon\n");
			for (String plot : plots) {
				csv.append(plot).append(",1,1,1\n");
			}
			Files.write(((File) i.getArgument(2)).toPath(), csv.toString().getBytes(StandardCharsets.UTF_8));
			return null;
		}).when(api).downloadMyCorrections(eq(cloud), eq("/v1/projects/p1/my-corrections.csv?v=" + version), any(File.class));
	}

	/** A save's answer: submitted (actively saved) or not */
	private static PlacemarkLoadResult saved(boolean submitted) {
		PlacemarkLoadResult result = new PlacemarkLoadResult();
		result.setSuccess(true);
		Map<String, PlacemarkInputFieldInfo> infos = new LinkedHashMap<>();
		PlacemarkInputFieldInfo activelySaved = new PlacemarkInputFieldInfo();
		activelySaved.setValue(String.valueOf(submitted));
		infos.put("collect_boolean_actively_saved", activelySaved);
		result.setInputFieldInfoByParameterName(infos);
		return result;
	}

	/** The first answer's record, read from its XML (kept apart), with its keys */
	private CollectRecord answerRecord() throws IOException {
		CollectRecord record = mock(CollectRecord.class);
		when(record.getRootEntityKeyValues()).thenReturn(Arrays.asList("17", "1"));
		when(surveys.parseDetachedRecord("<plot>ana</plot>")).thenReturn(record);
		when(surveys.detachedRecordXml(record)).thenReturn("<plot>corrected</plot>");
		when(surveys.detachedRecordSummary(record)).thenReturn(Collections.singletonMap("collect_code_lu", "F"));
		return record;
	}

	@Test
	public void theListAndItsPlotFileComeFromTheServerAndOpenInsteadOfThePersonsPlots() throws IOException {
		server("v1", "17", "18");
		service.check();
		assertTrue(service.file().isFile());
		assertEquals(2, service.toCorrect());
		assertFalse(service.isOpen());
		// said once, while the person is on their own plots
		assertEquals(1, notices.pending().size());

		assertTrue(service.open());
		assertEquals(service.file().getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
		assertTrue(service.isOpen());
		assertEquals(1, reloads.get());
		// the five-minute check of the person's plots leaves them open
		assertTrue(myPlots.onCorrections());

		assertTrue(service.close());
		assertEquals(myCopy.getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
		assertEquals("", values.get(EarthProperty.CLOUD_CORRECTIONS_FILE));
		assertFalse(service.isOpen());
	}

	@Test
	public void theSameVersionIsNotDownloadedAgain() throws IOException {
		server("v1", "17");
		service.check();
		service.check();
		verify(api, times(1)).downloadMyCorrections(eq(cloud), anyString(), any(File.class));
	}

	@Test
	public void theFormStartsFromTheFirstAnswerNoLongerSubmittedAndTheCorrectionIsSentOnSubmitNeverStoredHere() throws IOException {
		server("v1", "17");
		service.check();
		CollectRecord record = answerRecord();
		PlacemarkLoadResult loaded = saved(false);
		when(surveys.loadDetachedRecord(record)).thenReturn(loaded);
		assertTrue(service.load("17,1").isSuccess());
		verify(surveys, atLeastOnce()).startDetachedRecord(record);

		// a change: a draft, not sent
		when(surveys.updateDetachedRecord(eq(record), anyMap(), anyBoolean())).thenReturn(saved(false));
		CorrectionLoadResult draft = service.save("17,1", new HashMap<>(Collections.singletonMap("collect_code_lu", "G")), true);
		assertEquals("DRAFT", draft.getCorrection());
		assertEquals("partial", service.statuses().get("17,1"));
		verify(api, never()).putCorrection(any(), anyString(), anyString(), anyString(), anyMap(), any());

		// submitted: sent, with the plot unit, the record's keys and the answer it started from
		when(surveys.updateDetachedRecord(eq(record), anyMap(), anyBoolean())).thenReturn(saved(true));
		CorrectionLoadResult sent = service.save("17,1", new HashMap<>(Collections.singletonMap("collect_boolean_actively_saved", "true")), false);
		assertEquals("SENT", sent.getCorrection());
		verify(api).putCorrection(cloud, "17", "17,1", "<plot>corrected</plot>", Collections.singletonMap("collect_code_lu", "F"), "ana");
		assertEquals("saved", service.statuses().get("17,1"));
		assertEquals(0, service.toCorrect());
		// kept as a draft file, read again after a restart
		assertEquals(1, new File(service.folder(), CorrectionService.DRAFTS).list().length);
		// the local database never touched: only the methods of records kept apart
		verify(surveys, never()).updatePlacemarkData(any(), anyMap(), any(), anyBoolean());
	}

	@Test
	public void afterARestartTheListAndTheDraftsAreThereBeforeTheFirstCheck() throws IOException {
		// found in the real run: the first check comes some seconds after a start, and the plots list asks before
		server("v1", "17", "18");
		service.check();
		service.open();
		CollectRecord record = answerRecord();
		when(surveys.updateDetachedRecord(eq(record), anyMap(), anyBoolean())).thenReturn(saved(false));
		service.save("17,1", new HashMap<>(Collections.singletonMap("collect_code_lu", "G")), true);
		when(surveys.parseDetachedRecord("<plot>corrected</plot>")).thenReturn(record);
		when(surveys.loadDetachedRecord(record)).thenReturn(saved(false));

		CorrectionService again = new CorrectionService(properties, api, surveys, myPlots, notices, reloads::incrementAndGet, new File(folder, "cloud"));
		assertTrue(again.isOpen());
		assertEquals("partial", again.statuses().get("17,1"));
		assertEquals("empty", again.statuses().get("18,1"));
		assertEquals(2, again.toCorrect());
		assertTrue(again.load("17,1").isSuccess(), "its draft");
		verify(surveys).parseDetachedRecord("<plot>corrected</plot>");
	}

	@Test
	public void theReminderIsGivenOnceAStart() throws IOException {
		server("v1", "17");
		service.check();
		service.check();
		assertEquals(1, notices.pending().size());
		CorrectionService again = new CorrectionService(properties, api, surveys, myPlots, notices, reloads::incrementAndGet, new File(folder, "cloud"));
		again.check();
		assertEquals(2, notices.pending().size(), "the next start reminds again");
	}

	@Test
	public void aCorrectionTheServerRefusesIsSaidAndLeft() throws IOException {
		server("v1", "17");
		service.check();
		CollectRecord record = answerRecord();
		when(surveys.updateDetachedRecord(eq(record), anyMap(), anyBoolean())).thenReturn(saved(true));
		doThrow(new CloudApiException("no", 409, "not_assigned")).when(api).putCorrection(any(), anyString(), anyString(), anyString(), anyMap(), any());
		CorrectionLoadResult refused = service.save("17,1", new HashMap<>(), false);
		assertEquals("REFUSED", refused.getCorrection());
		assertNotNull(refused.getCorrectionReason());
		assertEquals("REFUSED", service.plotInfo("17,1").get("state"));

		// a coordinator gives it back (a new version of the list): no longer refused, the draft kept, to submit again
		server("v2", "17");
		service.check();
		assertEquals("DRAFT", service.plotInfo("17,1").get("state"));
		assertNull(service.plotInfo("17,1").get("reason"));
		// and it opens as not submitted: the form asks for the submit again
		when(surveys.loadDetachedRecord(record)).thenReturn(saved(false));
		service.load("17,1");
		// once as the correction started, once as it opens again a draft
		verify(surveys, times(2)).startDetachedRecord(record);
	}

	@Test
	public void offlineTheCorrectionWaitsAndIsSentAtTheNextCheck() throws IOException {
		server("v1", "17");
		service.check();
		CollectRecord record = answerRecord();
		when(surveys.updateDetachedRecord(eq(record), anyMap(), anyBoolean())).thenReturn(saved(true));
		doThrow(new IOException("offline")).when(api).putCorrection(any(), anyString(), anyString(), anyString(), anyMap(), any());
		assertEquals("PENDING", service.save("17,1", new HashMap<>(), false).getCorrection());
		// submitted: no longer to correct, shown done
		assertEquals("saved", service.statuses().get("17,1"));

		doAnswer(i -> null).when(api).putCorrection(any(), anyString(), anyString(), anyString(), anyMap(), any());
		service.check();
		assertEquals("SENT", service.plotInfo("17,1").get("state"));
	}

	@Test
	public void aPlotNotToCorrectIsRefusedAndNoAnswerLeavesTheXmlOut() throws IOException {
		server("v1", "17");
		service.check();
		assertEquals("REFUSED", service.save("99,1", new HashMap<>(), false).getCorrection());
		assertNull(service.plotInfo("99,1"));
		Map<String, Object> info = service.plotInfo("17,1");
		assertEquals("look at the trees", info.get("comment"));
		assertFalse(String.valueOf(info.get("answers")).contains("<plot>"), "the panel gets no XML");
	}

	@Test
	public void noPlotLeftWhileOpenGoesBackToThePersonsPlots() throws IOException {
		server("v1", "17");
		service.check();
		service.open();
		server("v2");
		service.check();
		assertFalse(service.isOpen());
		assertEquals(myCopy.getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
	}

	@Test
	public void anOlderServerIsNotAskedAgain() throws IOException {
		when(api.myCorrections(cloud)).thenThrow(new CloudApiException("not found", 404, null));
		service.check();
		assertTrue(service.isOlderServer());
		assertFalse(service.open());
		verifyNoMoreInteractions(surveys);
	}
}

package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.BatchResult;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.Destination;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.openforis.collect.earth.app.service.cloud.CloudService.InvalidCloudRequestException;
import org.openforis.collect.earth.app.service.dashboard.DashboardFeedSource;
import org.openforis.collect.earth.app.service.jobs.RecordingContext;
import org.openforis.collect.earth.app.service.notices.NoticeService;

/** Sending this computer's records to the cloud project: the checks, the batches, the counts and the refusals. */
public class CloudRecordsSenderTest {

	private static final String SURVEY = "http://openforis.org/test";

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final CloudApiClient api = mock(CloudApiClient.class);
	private final DashboardFeedSource source = mock(DashboardFeedSource.class);
	private final NoticeService notices = new NoticeService();
	private final Destination cloud = new Destination("https://cloud", "p1", "t");
	private final CloudRecordsSender sender = new CloudRecordsSender(properties, api, source, notices);

	@BeforeEach
	public void setUp() throws IOException {
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudSyncUrl()).thenReturn("https://cloud");
		when(properties.getCloudProjectId()).thenReturn("p1");
		when(properties.getCloudSyncToken()).thenReturn("t");
		when(properties.getOperator()).thenReturn("ana");
		when(source.surveyUri()).thenReturn(SURVEY);
		when(api.cloudDestination()).thenReturn(cloud);
	}

	private static RecordEnvelope envelope(int id) {
		return new RecordEnvelope("plot" + id, SURVEY, "Juan", new Date(), true, 1, "<plot/>", Collections.emptyMap(), false);
	}

	private void records(int count) throws IOException {
		when(source.recordIds()).thenReturn(IntStream.rangeClosed(1, count).boxed().collect(Collectors.toList()));
		when(source.load(anyInt())).thenAnswer(invocation -> envelope(invocation.getArgument(0, Integer.class)));
	}

	@SuppressWarnings("unchecked")
	@Test
	public void itSendsEveryRecordInBatchesOfFiftyKeepingTheirOperatorAndCountsWhatTheServerSaid() throws Exception {
		records(120);
		when(source.load(7)).thenReturn(null); // nothing answered in it: not sent
		when(api.uploadRecordsBatch(any(Destination.class), anyList())).thenAnswer(invocation -> {
			List<BatchResult> results = new ArrayList<>();
			for (RecordEnvelope e : (List<RecordEnvelope>) invocation.getArgument(1, List.class)) {
				String key = e.getRecordKey();
				results.add(key.equals("plot2") || key.equals("plot3") ? new BatchResult(key, "error", "malformed envelope")
						: key.equals("plot60") ? new BatchResult(key, "stale", null)
								: new BatchResult(key, "stored", null));
			}
			return results;
		});
		RecordingContext context = new RecordingContext();

		Map<String, Object> result = (Map<String, Object>) sender.sendJob().run(context);

		ArgumentCaptor<List<RecordEnvelope>> batches = ArgumentCaptor.forClass(List.class);
		ArgumentCaptor<Destination> to = ArgumentCaptor.forClass(Destination.class);
		verify(api, times(3)).uploadRecordsBatch(to.capture(), batches.capture());
		assertEquals(cloud, to.getValue(), "to the cloud project");
		assertEquals(49, batches.getAllValues().get(0).size(), "50 a batch, the one with nothing answered left out");
		assertEquals(50, batches.getAllValues().get(1).size());
		assertEquals(20, batches.getAllValues().get(2).size());
		assertEquals("Juan", batches.getAllValues().get(0).get(0).getOperator(), "the record's own operator");
		assertEquals(120, result.get("total"));
		assertEquals(117, result.get("sent"), "stored and stale");
		assertEquals(2, result.get("refused"));
		assertEquals(Collections.singletonList(Map.of("reason", "malformed envelope", "count", 2)), result.get("reasons"));
		assertEquals(Collections.singletonList("malformed envelope: 2"), context.messages);
		assertTrue(context.progress.contains("100 120 of 120 records sent"), context.progress.toString());
	}

	@Test
	public void aRecordTheServerSaysNothingAboutIsRefused() throws Exception {
		records(2);
		when(api.uploadRecordsBatch(any(Destination.class), anyList()))
				.thenReturn(Collections.singletonList(new BatchResult("plot1", "stored", null)));
		@SuppressWarnings("unchecked")
		Map<String, Object> result = (Map<String, Object>) sender.sendJob().run(new RecordingContext());
		assertEquals(1, result.get("sent"));
		assertEquals(1, result.get("refused"));
	}

	@Test
	public void aFailedBatchFailsTheJob() throws Exception {
		records(3);
		when(api.uploadRecordsBatch(any(Destination.class), anyList())).thenThrow(new IOException("HTTP 401"));
		assertThrows(IOException.class, () -> sender.sendJob().run(new RecordingContext()));
	}

	@Test
	public void aCancelledJobStopsBeforeTheNextBatch() throws Exception {
		records(3);
		RecordingContext context = new RecordingContext();
		context.cancelled = true;
		assertThrows(IOException.class, () -> sender.sendJob().run(context));
		verify(api, never()).uploadRecordsBatch(any(Destination.class), anyList());
	}

	@Test
	public void itRefusesToStartOutsideACloudProjectOrSignedOut() {
		when(properties.isCloudSyncEnabled()).thenReturn(false);
		assertEquals("cloud.notConnected", assertThrows(InvalidCloudRequestException.class, sender::sendJob).getCode());
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudSyncToken()).thenReturn("");
		assertEquals("cloud.notSignedIn", assertThrows(InvalidCloudRequestException.class, sender::sendJob).getCode());
		when(properties.getCloudSyncToken()).thenReturn("t");
		when(source.surveyUri()).thenReturn(null);
		assertEquals("cloud.noSurvey", assertThrows(InvalidCloudRequestException.class, sender::sendJob).getCode());
	}

	@Test
	public void theFirstStartAfterJoiningOffersToSendTheRecordsOnce() throws Exception {
		records(4);
		when(properties.getValue(EarthProperty.CLOUD_OFFER_LOCAL_RECORDS)).thenReturn("true");
		sender.onApplicationEvent(null);
		verify(properties).setValue(EarthProperty.CLOUD_OFFER_LOCAL_RECORDS, "");
		assertEquals(1, notices.pending().size());
		Map<String, Object> notice = notices.pending().get(0);
		assertEquals(CloudRecordsSender.OFFER_NOTICE, notice.get("kind"));
		assertTrue(((String) notice.get("message")).contains("4"), (String) notice.get("message"));
		@SuppressWarnings("unchecked")
		List<Map<String, String>> options = (List<Map<String, String>>) notice.get("options");
		assertEquals(CloudRecordsSender.SEND, options.get(options.size() - 1).get("id"));
	}

	@Test
	public void noOfferWithoutRecordsOrWithoutJoining() throws Exception {
		records(0);
		when(properties.getValue(EarthProperty.CLOUD_OFFER_LOCAL_RECORDS)).thenReturn("true");
		sender.onApplicationEvent(null);
		when(properties.getValue(EarthProperty.CLOUD_OFFER_LOCAL_RECORDS)).thenReturn("");
		records(4);
		sender.onApplicationEvent(null);
		assertTrue(notices.pending().isEmpty());
	}
}

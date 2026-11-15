package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.Destination;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.OwnRecords;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.io.data.DataImportSummary;
import org.openforis.collect.io.data.DataImportSummaryItem;
import org.openforis.collect.io.data.XMLDataImportProcess;

/** The person's own plots, brought from the cloud project to the computer that joins it (docs/plans/2026-11-15-workflow-review.md). */
public class CloudOwnRecordsFetcherTest {

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final CloudApiClient api = mock(CloudApiClient.class);
	private final DataImportExportService data = mock(DataImportExportService.class);
	private final EarthSurveyService surveys = mock(EarthSurveyService.class);
	private final NoticeService notices = new NoticeService();
	private final AtomicInteger reloads = new AtomicInteger();
	private final CloudOwnRecordsFetcher fetcher = new CloudOwnRecordsFetcher(properties, api, data, surveys, notices, reloads::incrementAndGet);
	private final Destination cloud = new Destination("https://cloud", "p1", "t");
	private File zip;

	@BeforeEach
	public void setUp() throws IOException {
		when(api.cloudDestination()).thenReturn(cloud);
		zip = Files.createTempFile("own-records", ".zip").toFile();
	}

	private XMLDataImportProcess summary(int toImport) throws Exception {
		XMLDataImportProcess process = mock(XMLDataImportProcess.class);
		DataImportSummary summary = mock(DataImportSummary.class);
		List<DataImportSummaryItem> items = Collections.nCopies(toImport, mock(DataImportSummaryItem.class));
		when(summary.getRecordsToImport()).thenReturn(items);
		when(process.getSummary()).thenReturn(summary);
		when(data.getImportSummary(eq(zip), anyBoolean())).thenReturn(process);
		return process;
	}

	/** A record's summary: its key, saved at `at` */
	private static CollectRecordSummary record(String key, long at) {
		CollectRecordSummary summary = mock(CollectRecordSummary.class);
		when(summary.getRootEntityKeyValues()).thenReturn(Arrays.asList(key.split(",")));
		when(summary.getModifiedDate()).thenReturn(new java.util.Date(at));
		return summary;
	}

	/** The records this computer has, by their keys, all saved at 1000 */
	private void here(String... keys) {
		List<CollectRecordSummary> summaries = new java.util.ArrayList<>();
		for (String key : keys) {
			summaries.add(record(key, 1000));
		}
		when(surveys.getRecordSummariesSavedSince(any())).thenReturn(summaries);
	}

	/** The server's records of the person, all saved at 1000 */
	private static java.util.Map<String, Long> saved(String... keys) {
		java.util.Map<String, Long> map = new java.util.LinkedHashMap<>();
		for (String key : keys) {
			map.put(key, 1000L);
		}
		return map;
	}

	private List<Object> noticeKinds() {
		return Arrays.asList(notices.pending().stream().map(n -> n.get("kind")).toArray());
	}

	@Test
	public void addsThePlotsThisComputerHasNotAndNeverReplacesOne() throws Exception {
		when(api.downloadOwnRecords(cloud)).thenReturn(new OwnRecords(zip, 3));
		XMLDataImportProcess process = summary(2); // of the 3, this computer has one already

		assertEquals(2, fetcher.fetch());

		// the drafts too; no conflicting record overwritten
		verify(data).getImportSummary(zip, true);
		verify(data).importRecordsFrom(zip, process, Collections.emptyList());
		assertEquals(1, reloads.get());
		assertTrue(noticeKinds().contains(CloudOwnRecordsFetcher.NOTICE));
		assertFalse(zip.exists(), "the downloaded file is deleted");
		verify(properties, never()).setValue(EarthProperty.CLOUD_FETCH_OWN_RECORDS, "true");
	}

	@Test
	public void nothingToBringIsQuiet() throws Exception {
		when(api.downloadOwnRecords(cloud)).thenReturn(new OwnRecords(zip, 0));

		assertEquals(0, fetcher.fetch());

		verify(data, never()).getImportSummary(any(), anyBoolean());
		assertEquals(0, reloads.get());
		assertTrue(notices.pending().isEmpty());
		assertFalse(zip.exists());
	}

	@Test
	public void plotsAllHereAlreadyAddNothing() throws Exception {
		when(api.downloadOwnRecords(cloud)).thenReturn(new OwnRecords(zip, 2));
		summary(0);

		assertEquals(0, fetcher.fetch());

		verify(data, never()).importRecordsFrom(any(), any(), any());
		assertTrue(notices.pending().isEmpty());
	}

	@Test
	public void aFailureSaysItAndTriesAgainAtTheNextStart() throws Exception {
		when(api.downloadOwnRecords(cloud)).thenThrow(new IOException("the server is not reachable"));

		assertEquals(-1, fetcher.fetch());

		verify(properties).setValue(EarthProperty.CLOUD_FETCH_OWN_RECORDS, "true");
		assertEquals(Notice.WARNING, notices.pending().get(0).get("severity"));
	}

	@Test
	public void atTheOtherStartsOnlyWhenTheServerHasRecordsOfTheirsThisComputerHasNot() throws Exception {
		here("P1,1", "P2,1", "P3,1");
		when(api.ownRecordKeys(cloud)).thenReturn(saved("P1,1", "P2,1"));
		assertFalse(fetcher.serverHasMore());
		// a colleague's copy of P3 here, theirs given now: as many as here, but P4 is new
		when(api.ownRecordKeys(cloud)).thenReturn(saved("P1,1", "P2,1", "P4,1"));
		assertTrue(fetcher.serverHasMore());
		// offline: nothing asked, nothing said
		when(api.ownRecordKeys(cloud)).thenThrow(new IOException("offline"));
		assertFalse(fetcher.serverHasMore());
	}

	@Test
	public void theCheckEveryFewMinutesBringsPlotsGivenMeanwhileAndSaysNoFailure() throws Exception {
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(surveys.getCollectSurvey()).thenReturn(mock(org.openforis.collect.model.CollectSurvey.class));
		here("P1,1", "P2,1");
		// nothing new: nothing asked for
		when(api.ownRecordKeys(cloud)).thenReturn(saved("P1,1", "P2,1"));
		fetcher.check();
		verify(api, never()).downloadOwnRecords(any());
		// the coordinator gave them two plots meanwhile
		when(api.ownRecordKeys(cloud)).thenReturn(saved("P1,1", "P2,1", "P3,1", "P4,1"));
		when(api.downloadOwnRecords(cloud)).thenReturn(new OwnRecords(zip, 4));
		summary(2);
		fetcher.check();
		assertEquals(1, reloads.get());
		// a failure in a check is not said (the next check tries again)
		int said = notices.pending().size();
		when(api.downloadOwnRecords(cloud)).thenThrow(new IOException("offline"));
		fetcher.check();
		assertEquals(said, notices.pending().size());
		assertEquals(10, CloudOwnRecordsFetcher.CHECK_MINUTES);
	}

	@Test
	public void theSamePersonOnTwoComputersGetsTheNewerSaveUnlessSomethingWaitsHere() throws Exception {
		CloudSyncService sync = mock(CloudSyncService.class);
		fetcher.setSync(sync);
		here("P1,1");
		// the other computer saved P1 again a minute later
		java.util.Map<String, Long> there = new java.util.LinkedHashMap<>();
		there.put("P1,1", 61_000L);
		when(api.ownRecordKeys(cloud)).thenReturn(there);
		when(sync.recordState("P1,1")).thenReturn("sent");
		assertTrue(fetcher.serverHasMore());
		// but not while this computer has a change of P1 not sent yet
		when(sync.recordState("P1,1")).thenReturn("pending");
		assertFalse(fetcher.serverHasMore());

		// the import: the newer copy replaces this one; an older one, or one with something unsent, does not
		when(sync.recordState("P1,1")).thenReturn("sent");
		when(sync.recordState("P2,1")).thenReturn("sent");
		when(sync.recordState("P3,1")).thenReturn("failed");
		when(api.downloadOwnRecords(cloud)).thenReturn(new OwnRecords(zip, 3));
		XMLDataImportProcess process = mock(XMLDataImportProcess.class);
		DataImportSummary summary = mock(DataImportSummary.class);
		when(summary.getRecordsToImport()).thenReturn(Collections.emptyList());
		DataImportSummaryItem newer = conflict("P1,1", 61_000, 1_000);
		DataImportSummaryItem older = conflict("P2,1", 1_000, 61_000);
		DataImportSummaryItem waiting = conflict("P3,1", 61_000, 1_000);
		when(summary.getConflictingRecords()).thenReturn(Arrays.asList(newer, older, waiting));
		when(process.getSummary()).thenReturn(summary);
		when(data.getImportSummary(eq(zip), anyBoolean())).thenReturn(process);
		assertEquals(1, fetcher.fetch());
		verify(data).importRecordsFrom(zip, process, Arrays.asList(newer));
	}

	private static DataImportSummaryItem conflict(String key, long thereAt, long hereAt) {
		DataImportSummaryItem item = mock(DataImportSummaryItem.class);
		CollectRecordSummary there = record(key, thereAt);
		CollectRecordSummary local = record(key, hereAt);
		when(item.getRecordSummary()).thenReturn(there);
		when(item.getConflictingRecordSummary()).thenReturn(local);
		return item;
	}

	@Test
	public void notInALocalProject() {
		when(properties.isCloudSyncEnabled()).thenReturn(false);
		fetcher.onApplicationEvent(null);
		verify(properties, never()).getValue(EarthProperty.CLOUD_FETCH_OWN_RECORDS);
	}
}

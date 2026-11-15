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
import org.openforis.collect.earth.app.service.dashboard.DashboardFeedSource;
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
	private final DashboardFeedSource local = mock(DashboardFeedSource.class);
	private final NoticeService notices = new NoticeService();
	private final AtomicInteger reloads = new AtomicInteger();
	private final CloudOwnRecordsFetcher fetcher = new CloudOwnRecordsFetcher(properties, api, data, surveys, local, notices, reloads::incrementAndGet);
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
	public void atTheOtherStartsOnlyWhenTheServerHasMoreOfTheirRecordsThanThisComputer() throws Exception {
		when(local.recordIds()).thenReturn(Arrays.asList(1, 2, 3));
		when(api.ownRecordsCount(cloud)).thenReturn(3);
		assertFalse(fetcher.serverHasMore());
		// the coordinator gave them a typed name's 2 plots
		when(api.ownRecordsCount(cloud)).thenReturn(5);
		assertTrue(fetcher.serverHasMore());
		// offline: nothing asked, nothing said
		when(api.ownRecordsCount(cloud)).thenThrow(new IOException("offline"));
		assertFalse(fetcher.serverHasMore());
	}

	@Test
	public void notInALocalProject() {
		when(properties.isCloudSyncEnabled()).thenReturn(false);
		fetcher.onApplicationEvent(null);
		verify(properties, never()).getValue(EarthProperty.CLOUD_FETCH_OWN_RECORDS);
	}
}

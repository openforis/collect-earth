package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.AssignmentInfo;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.CloudApiException;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.Destination;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.MyPlotsFile;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.MyPlotsInfo;
import org.openforis.collect.earth.app.service.notices.NoticeService;

/** The person's plots kept up to date (docs/plans/2026-11-16-plots-from-the-server.md, stage 2). */
public class MyPlotsServiceTest {

	@TempDir
	File folder;

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final CloudApiClient api = mock(CloudApiClient.class);
	private final CloudSyncService sync = mock(CloudSyncService.class);
	private final NoticeService notices = new NoticeService();
	private final AtomicInteger reloads = new AtomicInteger();
	private final Map<EarthProperty, String> values = new HashMap<>();
	private final Destination cloud = new Destination("https://cloud", "p1", "t");
	private MyPlotsService service;

	@BeforeEach
	public void setUp() throws IOException {
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudSyncToken()).thenReturn("t");
		when(properties.getCloudProjectId()).thenReturn("p1");
		when(properties.getProjectFolder()).thenReturn(folder.getAbsolutePath());
		when(properties.getValue(any(EarthProperty.class))).thenAnswer(i -> values.getOrDefault(i.getArgument(0), ""));
		doAnswer(i -> values.put(i.getArgument(0), i.getArgument(1))).when(properties).setValue(any(), any());
		when(api.cloudDestination()).thenReturn(cloud);
		when(sync.recordState(anyString())).thenReturn("sent");
		service = new MyPlotsService(properties, api, notices, reloads::incrementAndGet, new File(folder, "cloud"));
		service.setSync(sync);
		// the project file's own plot file, as a collector gets it: its header only
		values.put(EarthProperty.SAMPLE_FILE, write("grid.csv", "id,lat,lon,province\n").getAbsolutePath());
	}

	private File write(String name, String text) throws IOException {
		File file = new File(folder, name);
		Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
		return file;
	}

	/** The server's answer for a version: these rows, each with its plot file last */
	private void server(String version, String... rows) throws IOException {
		when(api.myPlots(cloud)).thenReturn(new MyPlotsInfo(version, rows.length, 1, "/v1/projects/p1/my-plots.csv?v=" + version, Collections.emptyList(), 0));
		StringBuilder text = new StringBuilder("id,lat,lon,province,plot_file\n");
		for (String row : rows) {
			text.append(row).append('\n');
		}
		File file = write("download-" + version + ".csv", text.toString());
		when(api.downloadMyPlots(cloud, "/v1/projects/p1/my-plots.csv?v=" + version)).thenReturn(new MyPlotsFile(file, true));
	}

	private String copyText() throws IOException {
		return new String(Files.readAllBytes(service.copy().toPath()), StandardCharsets.UTF_8);
	}

	private List<Object> noticeKinds() {
		return Arrays.asList(notices.pending().stream().map(n -> n.get("kind")).toArray());
	}

	@Test
	public void theFirstCheckMakesThePersonsPlotsThePlotsFileWithEachRowsPlotFileKeptApart() throws Exception {
		server("v1", "1,1,1,La Paz,north.csv", "2,2,2,\"Oruro, sur\",south.csv");
		assertEquals(MyPlotsService.Outcome.UPDATED, service.check());
		assertEquals("id,lat,lon,province\n1,1,1,La Paz\n2,2,2,\"Oruro, sur\"\n", copyText());
		assertEquals(service.copy().getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
		assertEquals(1, reloads.get());
		assertEquals(Arrays.asList(MyPlotsService.NOTICE), noticeKinds());
		// the record keeps the plot file each plot comes from
		assertEquals("north.csv", service.plotFileOf("1"));
		assertEquals("south.csv", service.plotFileOf("2"));
		assertNull(service.plotFileOf("3"));
		assertTrue(service.isCopy(service.copy().getAbsolutePath()));
		assertEquals(2, service.status().get("plots"));
		assertEquals("myPlots", service.status().get("mode"));
		assertEquals(true, service.status().get("inUse"));
	}

	@Test
	public void theSameVersionIsNotDownloadedAgainAndNothingIsReloaded() throws Exception {
		server("v1", "1,1,1,La Paz,north.csv");
		service.check();
		assertEquals(MyPlotsService.Outcome.UNCHANGED, service.check());
		verify(api, times(1)).downloadMyPlots(any(), anyString());
		assertEquals(1, reloads.get());
	}

	@Test
	public void aChangeIsDownloadedReloadedAndSaid() throws Exception {
		server("v1", "1,1,1,La Paz,north.csv", "2,2,2,Oruro,north.csv");
		service.check();
		int said = notices.pending().size();
		server("v2", "2,2,2,Oruro,north.csv", "3,3,3,Potosi,south.csv");
		assertEquals(MyPlotsService.Outcome.UPDATED, service.check());
		assertEquals("id,lat,lon,province\n2,2,2,Oruro\n3,3,3,Potosi\n", copyText());
		assertEquals(2, reloads.get());
		assertEquals(said + 1, notices.pending().size());
		assertTrue(String.valueOf(notices.pending().get(notices.pending().size() - 1).get("message")).contains("1"));
	}

	@Test
	public void aPlotTakenAwayWithWorkNotSentStaysUntilItIsSent() throws Exception {
		server("v1", "1,1,1,La Paz,north.csv", "2,2,2,Oruro,north.csv");
		service.check();
		// the coordinator moves plot 1 away while its record waits to be sent
		when(sync.recordState("1")).thenReturn("pending");
		server("v2", "2,2,2,Oruro,north.csv");
		service.check();
		assertEquals("id,lat,lon,province\n2,2,2,Oruro\n1,1,1,La Paz\n", copyText());
		assertEquals("north.csv", service.plotFileOf("1"));
		// sent: at the next check it goes, though the server's plots did not change
		when(sync.recordState("1")).thenReturn("sent");
		assertEquals(MyPlotsService.Outcome.UPDATED, service.check());
		assertEquals("id,lat,lon,province\n2,2,2,Oruro\n", copyText());
		verify(api, times(2)).downloadMyPlots(any(), anyString());
	}

	@Test
	public void anOpenTrainingSetStaysThePlotsFileUntilThePersonGoesBack() throws Exception {
		File training = write("Learning - set.csv", "id,lat,lon,province\n10,1,1,x\n");
		values.put(EarthProperty.SAMPLE_FILE, training.getAbsolutePath());
		values.put(EarthProperty.CLOUD_TRAINING_FILE, training.getAbsolutePath());
		server("v1", "1,1,1,La Paz,north.csv");
		service.check();
		assertEquals(training.getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
		assertEquals("Learning - set.csv", service.status().get("training"));
		assertNull(service.plotFileOf("1"));
		assertTrue(service.useMyPlots());
		assertEquals(service.copy().getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
		assertEquals("", values.get(EarthProperty.CLOUD_TRAINING_FILE));
	}

	@Test
	public void anOlderServerKeepsTheAssignedFilesOfBeforeAndSomeoneNotInTheProjectNothingChanges() throws Exception {
		when(api.myPlots(cloud)).thenThrow(new CloudApiException("myPlots failed with HTTP 404", 404, "not_found"));
		when(api.getMyAssignments()).thenReturn(Arrays.asList(new AssignmentInfo("f1", "north.csv", "c", "/p", 3)));
		assertEquals(MyPlotsService.Outcome.OLDER_SERVER, service.check());
		assertEquals("files", service.status().get("mode"));
		when(api.getMyAssignments()).thenThrow(new CloudApiException("getMyAssignments failed with HTTP 404", 404, "not_found"));
		assertEquals(MyPlotsService.Outcome.NOT_MEMBER, service.check());
		assertEquals(0, reloads.get());
		assertTrue(values.get(EarthProperty.SAMPLE_FILE).endsWith("grid.csv"));
	}

	@Test
	public void offlineTheLastCopyIsUsedEvenAfterTheProjectWasLoadedAgain() throws Exception {
		server("v1", "1,1,1,La Paz,north.csv");
		service.check();
		// "Load" of the project puts the project file's plot file back; then no network
		values.put(EarthProperty.SAMPLE_FILE, new File(folder, "grid.csv").getAbsolutePath());
		when(api.myPlots(cloud)).thenThrow(new IOException("offline"));
		assertEquals(MyPlotsService.Outcome.UPDATED, service.check());
		assertEquals(service.copy().getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
		assertEquals(MyPlotsService.Outcome.OFFLINE, service.check());
	}

	@Test
	public void holdingNoPlotTheCopyKeepsAHeaderRow() throws Exception {
		when(api.myPlots(cloud)).thenReturn(new MyPlotsInfo("v0", 0, 1, "/v1/projects/p1/my-plots.csv?v=v0", Collections.emptyList(), 0));
		when(api.downloadMyPlots(cloud, "/v1/projects/p1/my-plots.csv?v=v0")).thenReturn(new MyPlotsFile(write("empty.csv", ""), false));
		write("project_definition.properties", "csv=${project_path}/grid.csv\n");
		service.check();
		// the readers of plot files refuse an empty one: the project file's header row
		assertEquals("id,lat,lon,province\n", copyText());
		assertEquals(0, service.status().get("plots"));
	}

	@Test
	public void atTheJoinThePlotsFileIsThePersonsPlotsBeforeTheRestart() throws Exception {
		Destination joined = new Destination("https://cloud", "p2", "t2");
		when(api.myPlots(joined)).thenReturn(new MyPlotsInfo("v1", 1, 1, "/v1/projects/p2/my-plots.csv?v=v1", Collections.emptyList(), 0));
		when(api.downloadMyPlots(joined, "/v1/projects/p2/my-plots.csv?v=v1")).thenReturn(new MyPlotsFile(write("p2.csv", "id,lat,lon,province,plot_file\n7,1,1,x,a.csv\n"), true));
		assertTrue(service.atJoin(joined));
		File copy = new File(new File(new File(folder, "cloud"), "p2"), MyPlotsService.COPY);
		assertEquals(copy.getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
		assertEquals("id,lat,lon,province\n7,1,1,x\n", new String(Files.readAllBytes(copy.toPath()), StandardCharsets.UTF_8));
		assertEquals(0, reloads.get());
		// an older server: nothing at the join, the start takes the assigned file
		Destination older = new Destination("https://old", "p3", "t3");
		when(api.myPlots(older)).thenThrow(new CloudApiException("404", 404, "not_found"));
		when(api.getMyAssignments()).thenReturn(Collections.emptyList());
		assertFalse(service.atJoin(older));
	}

	@Test
	public void aVersionThatChangedWhileItWasDownloadedIsAskedAgain() throws Exception {
		when(api.myPlots(cloud)).thenReturn(new MyPlotsInfo("v1", 1, 1, "/a?v=v1", Collections.emptyList(), 0),
				new MyPlotsInfo("v2", 1, 1, "/a?v=v2", Collections.emptyList(), 0));
		when(api.downloadMyPlots(cloud, "/a?v=v1")).thenThrow(new CloudApiException("409", 409, "changed"));
		when(api.downloadMyPlots(cloud, "/a?v=v2")).thenReturn(new MyPlotsFile(write("v2.csv", "id,lat,lon,province,plot_file\n5,1,1,x,a.csv\n"), true));
		assertEquals(MyPlotsService.Outcome.UPDATED, service.check());
		assertEquals("id,lat,lon,province\n5,1,1,x\n", copyText());
	}

	@Test
	public void outsideACloudProjectNothingIsAsked() throws Exception {
		when(properties.isCloudSyncEnabled()).thenReturn(false);
		assertEquals(MyPlotsService.Outcome.NOT_CLOUD, service.check());
		verify(api, never()).myPlots(any());
		assertEquals("none", service.status().get("mode"));
		verify(properties, never()).setValue(eq(EarthProperty.SAMPLE_FILE), any());
	}
}

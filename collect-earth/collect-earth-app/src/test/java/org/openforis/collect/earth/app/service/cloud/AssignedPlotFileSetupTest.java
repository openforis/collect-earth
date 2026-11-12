package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.AssignedPlotFileSetup.Outcome;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.AssignmentInfo;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.JoinPreview;
import org.openforis.collect.earth.app.service.cloud.CloudService.JoinRequest;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.service.settings.SettingsModel;
import org.openforis.collect.earth.app.service.settings.SettingsService;
import org.openforis.collect.earth.app.service.settings.SettingsValidator;
import org.openforis.collect.earth.app.view.Messages;

/**
 * The plot file assigned to a collector, set up at the first start after a join (or after the cloud project was opened
 * again): with the cloud server faked, the plots file saved through the settings as Apply saves it.
 */
public class AssignedPlotFileSetupTest {

	@TempDir
	File folder;
	private final CloudApiClient api = mock(CloudApiClient.class);
	private final EarthProjectsService projects = mock(EarthProjectsService.class);
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final CloudService cloud = new CloudService(api, mock(CloudSyncService.class), projects, properties);
	private final NoticeService notices = new NoticeService();
	private final Map<String, String> stored = new HashMap<>();
	private final AtomicInteger reloads = new AtomicInteger();
	private File assignments;
	private AssignedPlotFileSetup setup;

	/** A cloud project just joined: its plots file is the project file's own, empty one */
	@BeforeEach
	public void aCloudProjectJustJoined() throws Exception {
		File idm = new File(folder, "kenya/placemark.idm.xml");
		assignments = new File(idm.getParentFile(), "assignments");
		File ownPlots = new File(idm.getParentFile(), "kenya.csv");
		stored.put("sample_shape", "SQUARE");
		stored.put("number_of_sampling_points_in_plot", "25");
		stored.put("distance_between_sample_points", "10");
		stored.put("distance_to_plot_boundaries", "0");
		stored.put("inner_point_side", "2");
		stored.put("db_driver", "CLOUD");
		stored.put("csv", ownPlots.getAbsolutePath());
		when(properties.getValue(any(EarthProperty.class))).thenAnswer(call -> {
			String value = stored.get(call.getArgument(0).toString());
			return value == null ? "" : value;
		});
		org.mockito.Mockito.doAnswer(call -> {
			Map<String, String> values = call.getArgument(0);
			stored.putAll(values);
			return null;
		}).when(properties).setValues(any());
		when(properties.getImdFile()).thenReturn(idm.getAbsolutePath());
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudSyncUrl()).thenReturn("https://c.org");
		when(properties.getCloudProjectId()).thenReturn("p1");
		when(properties.getCloudSyncToken()).thenReturn("session-token");
		when(properties.getCloudBinding()).thenReturn(new CloudBinding(idm.getParent(), "https://c.org", "p1", "Kenya 2025", "maria"));
		when(properties.getViewerType()).thenReturn("plots_map");
		when(properties.getWindowLayout()).thenReturn("auto");
		when(properties.getMapEngine()).thenReturn("leaflet");
		when(properties.getCollectDBDriver()).thenReturn(CollectDBDriver.CLOUD);
		// The settings as the page's Apply saves them, with the rule of a cloud project's plots file
		SettingsValidator validator = new SettingsValidator(new SettingsModel(LocalDate.of(2026, 11, 12)), () -> LocalDate.of(2026, 11, 12),
				() -> CloudService.assignmentsFolderOf(properties.getImdFile()), () -> properties.getValue(EarthProperty.SAMPLE_FILE));
		SettingsService settings = new SettingsService(properties, validator, () -> {
			throw new AssertionError("No restart for a plots file");
		}, reloads::incrementAndGet);
		setup = new AssignedPlotFileSetup(cloud, properties, settings, notices);
		when(api.downloadAssignedCsv(any(), any())).thenAnswer(call -> {
			AssignmentInfo info = call.getArgument(0);
			File target = call.getArgument(1);
			target.mkdirs();
			File csv = new File(target, info.getFilename());
			Files.write(csv.toPath(), "id,YCoordinate,XCoordinate\nk1,1,2\n".getBytes());
			return csv;
		});
	}

	private void assigned(AssignmentInfo... files) throws IOException {
		when(api.getMyAssignments()).thenReturn(Arrays.asList(files));
	}

	private String noticeMessage() {
		List<Map<String, Object>> pending = notices.pending();
		assertEquals(1, pending.size());
		assertEquals(AssignedPlotFileSetup.NOTICE, pending.get(0).get("kind"));
		return (String) pending.get(0).get("message");
	}

	@Test
	public void theOnlyFileAssignedIsMadeThePlotsFileAfterTheJoin() throws Exception {
		// The join itself, as CloudServiceTest has it, then the start that follows
		File cep = new File(folder, "kenya.cep");
		Files.write(cep.toPath(), new byte[] { 1 });
		when(api.login("https://c.org", "maria", "pw", null, "tok")).thenReturn("session-token");
		when(api.downloadCep("https://c.org", "p1", "session-token")).thenReturn(cep);
		when(api.getProject(any())).thenReturn(new JoinPreview("p1", "Kenya 2025", "operator", true));
		JoinRequest request = new JoinRequest();
		request.baseUrl = "https://c.org";
		request.inviteToken = "tok";
		request.projectId = "p1";
		request.username = "maria";
		request.password = "pw";
		cloud.join(request);
		verify(projects).loadCompressedProjectFile(cep);
		// The join asks nothing about the plots: the start after it does
		verify(api, never()).getMyAssignments();

		assigned(new AssignmentInfo("a1", "north.csv", "c1", "/d/a1", 120));
		assertEquals(Outcome.APPLIED, setup.run());
		File north = new File(assignments, "north.csv");
		assertEquals(north.getAbsolutePath(), stored.get("csv"));
		assertEquals(1, reloads.get());
		assertTrue(noticeMessage().contains("north.csv"));
		// Once the plots file is an assigned one, nothing is asked again
		assertEquals(Outcome.NOT_NEEDED, setup.run());
		verify(api, org.mockito.Mockito.times(1)).getMyAssignments();
		verify(api, org.mockito.Mockito.times(1)).downloadAssignedCsv(any(), any());
	}

	@Test
	public void severalFilesAreLeftToTheCollectorToChoose() throws Exception {
		String before = stored.get("csv");
		assigned(new AssignmentInfo("a1", "north.csv", "c1", "/d/a1", 120), new AssignmentInfo("a2", "south.csv", "c2", "/d/a2", 80));
		assertEquals(Outcome.SEVERAL, setup.run());
		assertEquals(before, stored.get("csv"));
		assertEquals(0, reloads.get());
		verify(api, never()).downloadAssignedCsv(any(), any());
		assertEquals(java.text.MessageFormat.format(Messages.getString("CloudPlotFile.several"), 2), noticeMessage());
		// The project opened again later: asked again, as the plots file is still not an assigned one
		assertEquals(Outcome.SEVERAL, setup.run());
	}

	@Test
	public void noFileAssignedYetIsSaid() throws Exception {
		String before = stored.get("csv");
		assigned();
		assertEquals(Outcome.NONE, setup.run());
		assertEquals(before, stored.get("csv"));
		assertEquals(Messages.getString("CloudPlotFile.none"), noticeMessage());
	}

	@Test
	public void aServerNotAnsweringIsSaidAndTheJoinStillSucceeds() throws Exception {
		File cep = new File(folder, "kenya.cep");
		Files.write(cep.toPath(), new byte[] { 1 });
		when(api.login("https://c.org", "maria", "pw", null, "tok")).thenReturn("session-token");
		when(api.downloadCep("https://c.org", "p1", "session-token")).thenReturn(cep);
		when(api.getMyAssignments()).thenThrow(new IOException("Connection refused"));
		JoinRequest request = new JoinRequest();
		request.baseUrl = "https://c.org";
		request.inviteToken = "tok";
		request.projectId = "p1";
		request.username = "maria";
		request.password = "pw";
		cloud.join(request);
		verify(properties).setCloudSyncEnabled(true);

		String before = stored.get("csv");
		assertEquals(Outcome.FAILED, setup.run());
		assertEquals(before, stored.get("csv"));
		assertEquals(Messages.getString("CloudPlotFile.failed"), noticeMessage());
	}

	@Test
	public void aDownloadThatFailsIsSaidAndKeepsThePlotsFile() throws Exception {
		String before = stored.get("csv");
		assigned(new AssignmentInfo("a1", "north.csv", "c1", "/d/a1", 120));
		org.mockito.Mockito.doThrow(new IOException("checksum mismatch")).when(api).downloadAssignedCsv(any(), any());
		assertEquals(Outcome.FAILED, setup.run());
		assertEquals(before, stored.get("csv"));
		assertEquals(0, reloads.get());
		assertEquals(Messages.getString("CloudPlotFile.failed"), noticeMessage());
	}

	/** Taking a learning set's file in a new attempt deletes earlier records: only the collector does it, once */
	@Test
	public void aLearningSetInANewAttemptIsNeverTakenByItself() throws Exception {
		EarthSurveyService surveys = mock(EarthSurveyService.class);
		cloud.setSurveyService(surveys);
		String before = stored.get("csv");
		assigned(new AssignmentInfo("s1", "Learning nov.csv", "c", "/d/s1", 2, new Date(1000L)));
		assertEquals(Outcome.LEARNING_SET, setup.run());
		assertEquals(Outcome.LEARNING_SET, setup.run());
		assertEquals(before, stored.get("csv"));
		verify(api, never()).downloadAssignedCsv(any(), any());
		verify(surveys, never()).deleteRecordsSavedBefore(any(), any());
		assertEquals(2, notices.pending().size());
		assertEquals(java.text.MessageFormat.format(Messages.getString("CloudPlotFile.learningSet"), "Learning nov.csv"),
				notices.pending().get(0).get("message"));
	}

	@Test
	public void aLearningSetWithNoNewAttemptIsTakenAsAnyFile() throws Exception {
		assigned(new AssignmentInfo("s1", "Learning nov.csv", "c", "/d/s1", 2, null));
		assertEquals(Outcome.APPLIED, setup.run());
		assertEquals(new File(assignments, "Learning nov.csv").getAbsolutePath(), stored.get("csv"));
	}

	@Test
	public void nothingIsAskedOutsideACloudProjectOrOfACoordinator() throws Exception {
		when(properties.isCloudSyncEnabled()).thenReturn(false);
		assertEquals(Outcome.NOT_NEEDED, setup.run());
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		CloudBinding coordinator = new CloudBinding(folder.getPath(), "https://c.org", "p1", "Kenya 2025", "ana");
		coordinator.role = "admin";
		when(properties.getCloudBinding()).thenReturn(coordinator);
		assertEquals(Outcome.NOT_NEEDED, setup.run());
		verify(api, never()).getMyAssignments();
		assertEquals(Collections.emptyList(), notices.pending());
	}
}

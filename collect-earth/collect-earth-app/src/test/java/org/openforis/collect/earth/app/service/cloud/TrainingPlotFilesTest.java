package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
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
import java.text.MessageFormat;
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
import org.mockito.ArgumentCaptor;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.AssignmentInfo;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.MyAssignment;
import org.openforis.collect.earth.app.service.cloud.TrainingPlotFiles.Outcome;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.model.CollectSurvey;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Training the team (docs/plans/2026-11-17-training-the-team.md) as Collect Earth follows it, with the person's plots
 * from the server (MyPlotsService): a new training set opened by itself while the person holds no plot of their own, or
 * offered; after the training, its records and file gone and the person's plots back. The cloud server faked.
 */
public class TrainingPlotFilesTest {

	private static final String DAY_1 = "Learning – Day 1.csv";

	@TempDir
	File folder;
	private final CloudApiClient api = mock(CloudApiClient.class);
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final EarthSurveyService surveys = mock(EarthSurveyService.class);
	private final NoticeService notices = new NoticeService();
	private final Map<EarthProperty, String> values = new HashMap<>();
	private final AtomicInteger reloads = new AtomicInteger();
	private final CloudService cloud = new CloudService(api, mock(CloudSyncService.class), mock(EarthProjectsService.class), properties);
	private MyPlotsService myPlots;
	private TrainingPlotFiles training;
	private File assignments;

	private final AssignmentInfo day1 = new AssignmentInfo("s1", DAY_1, "c3", "/d/s1", 2).training("learning");

	@BeforeEach
	public void aCollectorOfACloudProject() throws Exception {
		File idm = new File(folder, "kenya/placemark.idm.xml");
		assignments = new File(idm.getParentFile(), "assignments");
		assignments.mkdirs();
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudSyncToken()).thenReturn("t");
		when(properties.getCloudProjectId()).thenReturn("p1");
		when(properties.getImdFile()).thenReturn(idm.getAbsolutePath());
		when(properties.getValue(any(EarthProperty.class))).thenAnswer(i -> values.getOrDefault(i.getArgument(0), ""));
		doAnswer(i -> values.put(i.getArgument(0), i.getArgument(1))).when(properties).setValue(any(), any());
		myPlots = new MyPlotsService(properties, api, notices, reloads::incrementAndGet, new File(folder, "cloud"));
		cloud.setMyPlots(myPlots);
		cloud.setNotices(notices);
		cloud.setSurveyService(surveys);
		when(surveys.getCollectSurvey()).thenReturn(mock(CollectSurvey.class));
		when(surveys.getKeyAttributeCount()).thenReturn(1);
		training = new TrainingPlotFiles(cloud, properties, notices);
		when(api.downloadAssignedCsv(any(), any())).thenAnswer(call -> {
			AssignmentInfo info = call.getArgument(0);
			return write(new File(assignments, info.getFilename()), "id,lat,lon\nT-1,1,2\nT-3,1,3\n");
		});
	}

	private static File write(File file, String content) throws IOException {
		file.getParentFile().mkdirs();
		Files.write(file.toPath(), content.getBytes(StandardCharsets.UTF_8));
		return file;
	}

	/** The person's plots as MyPlotsService keeps them, the plots file */
	private File myPlots(String rows) throws IOException {
		File copy = write(myPlots.copy(), "id,lat,lon\n" + rows);
		values.put(EarthProperty.SAMPLE_FILE, copy.getAbsolutePath());
		return copy;
	}

	/** A training set the person opened (Settings › Project), the plots file */
	private File opened(String name) throws IOException {
		File file = write(new File(assignments, name), "id,lat,lon\nT-1,1,2\nT-3,1,3\n");
		values.put(EarthProperty.SAMPLE_FILE, file.getAbsolutePath());
		values.put(EarthProperty.CLOUD_TRAINING_FILE, file.getAbsolutePath());
		return file;
	}

	private void server(List<AssignmentInfo> files, List<String> finishedFiles, List<String> finishedPlots) throws IOException {
		when(api.getMyAssignment()).thenReturn(new MyAssignment(files, finishedFiles, finishedPlots));
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, String>> options(Map<String, Object> notice) {
		return (List<Map<String, String>>) notice.get("options");
	}

	@Test
	public void aNewTrainingOpensByItselfWhileThePersonHoldsNoPlotOfTheirOwn() throws Exception {
		myPlots("");
		server(Collections.singletonList(day1), Collections.emptyList(), Collections.emptyList());
		assertEquals(Outcome.NOTHING, training.check());
		File day = new File(assignments, DAY_1);
		assertEquals(day.getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
		assertEquals(day.getAbsolutePath(), values.get(EarthProperty.CLOUD_TRAINING_FILE));
		assertEquals(MessageFormat.format(Messages.getString("CloudTraining.opened"), DAY_1, 2), notices.pending().get(0).get("message"));
		assertEquals("Learning – Day 1", TrainingPlotFiles.trainingName(day.getAbsolutePath(), values.get(EarthProperty.CLOUD_TRAINING_FILE)));
		// Once: the next check leaves it as it is
		assertEquals(Outcome.NOTHING, training.check());
		assertEquals(1, notices.pending().size());
		verify(api, times(1)).downloadAssignedCsv(any(), any());
	}

	@Test
	public void withPlotsOfTheirOwnANewTrainingIsOfferedNotOpened() throws Exception {
		File mine = myPlots("1,1,1\n2,2,2\n");
		server(Collections.singletonList(day1), Collections.emptyList(), Collections.emptyList());
		assertEquals(Outcome.NOTHING, training.check());
		assertEquals(mine.getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
		Map<String, Object> offer = notices.pending().get(0);
		assertEquals(MessageFormat.format(Messages.getString("MyPlots.trainingOffer"), DAY_1), offer.get("message"));
		assertEquals(Outcome.NOTHING, training.check());
		assertEquals(1, notices.pending().size(), "offered once");
		verify(api, never()).downloadAssignedCsv(any(), any());
	}

	@Test
	public void aNewAttemptOfALearningSetIsOnlyOffered() throws Exception {
		myPlots("");
		AssignmentInfo again = new AssignmentInfo("s1", DAY_1, "c4", "/d/s1", 2, new Date(1000L)).training("learning");
		server(Collections.singletonList(again), Collections.emptyList(), Collections.emptyList());
		training.check();
		verify(api, never()).downloadAssignedCsv(any(), any());
		assertEquals(MessageFormat.format(Messages.getString("MyPlots.trainingOffer"), DAY_1), notices.pending().get(0).get("message"));
	}

	@Test
	public void theTrainingOverTakesItsRecordsAndFileAwayAndThePersonsPlotsComeBack() throws Exception {
		File mine = myPlots("1,1,1\n");
		File day = opened(DAY_1);
		when(surveys.deleteRecordsOf(any())).thenReturn(2);
		server(Collections.emptyList(), Collections.singletonList(DAY_1), Arrays.asList("T-1", "T-3"));

		assertEquals(Outcome.BACK_TO_MY_PLOTS, training.check());
		assertEquals(mine.getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
		assertEquals("", values.get(EarthProperty.CLOUD_TRAINING_FILE));
		assertEquals(1, reloads.get());
		assertFalse(day.exists());
		@SuppressWarnings("unchecked")
		ArgumentCaptor<List<String[]>> keys = ArgumentCaptor.forClass(List.class);
		verify(surveys).deleteRecordsOf(keys.capture());
		assertArrayEquals(new String[] { "T-1" }, keys.getValue().get(0));
		assertArrayEquals(new String[] { "T-3" }, keys.getValue().get(1));
		assertEquals(Messages.getString("CloudTraining.over"), notices.pending().get(0).get("message"));
		// Done once for these plots
		assertEquals(Outcome.NOTHING, training.check());
		verify(surveys, times(1)).deleteRecordsOf(any());
		assertEquals(1, notices.pending().size());
	}

	@Test
	public void withNoCopyOfThePersonsPlotsYetTheTrainingFileIsLeftWithoutPlots() throws Exception {
		File day = opened(DAY_1);
		server(Collections.emptyList(), Collections.singletonList(DAY_1), Arrays.asList("T-1", "T-3"));
		assertEquals(Outcome.NOTHING, training.check());
		assertEquals(Collections.singletonList("id,lat,lon"), Files.readAllLines(day.toPath()));
		assertEquals(day.getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));
	}

	@Test
	public void theFileOfASetNotRunningAnyMoreGoesAndTheOtherFilesStay() throws Exception {
		myPlots("1,1,1\n");
		File deleted = write(new File(assignments, "Calibration – old.csv"), "id\nT-9\n");
		File running = write(new File(assignments, DAY_1), "id\nT-1\n");
		File before = write(new File(assignments, "north.csv"), "id\n1\n");
		values.put(EarthProperty.CLOUD_TRAINING_OFFERED, "s1:c3");
		server(Collections.singletonList(day1), Collections.emptyList(), Collections.singletonList("T-9"));

		assertEquals(Outcome.NOTHING, training.check());
		assertFalse(deleted.exists());
		assertTrue(running.exists());
		assertTrue(before.exists(), "an assigned file of before is no training's");
		verify(surveys).deleteRecordsOf(any());
	}

	@Test
	public void theRecordsOfAPlotOfSeveralKeysAreFoundByEachKey() {
		when(surveys.getKeyAttributeCount()).thenReturn(2);
		cloud.deleteTrainingRecords(Collections.singletonList("T-1,2026"));
		@SuppressWarnings("unchecked")
		ArgumentCaptor<List<String[]>> keys = ArgumentCaptor.forClass(List.class);
		verify(surveys).deleteRecordsOf(keys.capture());
		assertArrayEquals(new String[] { "T-1", "2026" }, keys.getValue().get(0));
	}

	@Test
	public void nothingHappensWithoutTheServerOrOutsideACloudProject() throws Exception {
		File mine = myPlots("1,1,1\n");
		when(api.getMyAssignment()).thenThrow(new IOException("Connection refused"));
		assertEquals(Outcome.FAILED, training.check());
		assertEquals(Collections.emptyList(), notices.pending());
		assertEquals(mine.getAbsolutePath(), values.get(EarthProperty.SAMPLE_FILE));

		when(properties.isCloudSyncEnabled()).thenReturn(false);
		assertEquals(Outcome.NOT_NEEDED, training.check());
		verify(api, times(1)).getMyAssignment();
	}

	@Test
	public void aRunningCollectEarthAsksEveryFewMinutes() throws Exception {
		myPlots("1,1,1\n");
		server(Collections.emptyList(), Collections.emptyList(), Collections.emptyList());
		training.checkIfDue(1_000_000L);
		training.checkIfDue(1_000_000L + TrainingPlotFiles.CHECK_INTERVAL_MS - 1);
		verify(api, times(1)).getMyAssignment();
		training.checkIfDue(1_000_000L + TrainingPlotFiles.CHECK_INTERVAL_MS);
		verify(api, times(2)).getMyAssignment();
	}

	@Test
	public void theListSaysWhenThePlotsAreATrainingSet() {
		String day = new File(assignments, DAY_1).getAbsolutePath();
		assertEquals("Learning – Day 1", TrainingPlotFiles.trainingName(day, day));
		assertNull(TrainingPlotFiles.trainingName(day, ""));
		assertNull(TrainingPlotFiles.trainingName(new File(folder, "my-plots.csv").getAbsolutePath(), day));
	}

	/** my-assignment as the server answers it, and as a server from before the training of the team answered it */
	@Test
	public void theAnswerOfTheServerIsRead() throws Exception {
		ObjectMapper json = new ObjectMapper();
		MyAssignment mine = CloudApiClient.readMyAssignment(json.readTree("{\"assignments\":["
				+ "{\"csvFileId\":\"a1\",\"filename\":\"north.csv\",\"checksum\":\"c\",\"downloadPath\":\"/d\",\"plotCount\":3},"
				+ "{\"csvFileId\":\"s1\",\"filename\":\"Calibration – Day 1.csv\",\"plotCount\":2,"
				+ "\"training\":{\"kind\":\"calibration\",\"attempt\":1,\"freshSince\":null,\"serverTime\":5}}],"
				+ "\"finishedTraining\":{\"files\":[\"Learning – Week 0.csv\"],\"plots\":[\"T-1\",\"T-3\"]}}"), 5L);
		assertNull(mine.getAssignments().get(0).getTrainingKind());
		assertEquals("calibration", mine.getAssignments().get(1).getTrainingKind());
		assertNull(mine.getAssignments().get(1).getFreshSince());
		assertEquals(Collections.singletonList("Learning – Week 0.csv"), mine.getFinishedFiles());
		assertEquals(Arrays.asList("T-1", "T-3"), mine.getFinishedPlots());

		MyAssignment older = CloudApiClient.readMyAssignment(json.readTree("{\"assignments\":[]}"), 5L);
		assertEquals(Collections.emptyList(), older.getFinishedFiles());
		assertEquals(Collections.emptyList(), older.getFinishedPlots());
	}
}

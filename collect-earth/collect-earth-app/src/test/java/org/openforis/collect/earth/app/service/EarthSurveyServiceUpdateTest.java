package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.SurveyRevision;
import org.openforis.collect.earth.app.service.cloud.SurveyUpdateBackup;
import org.openforis.collect.earth.app.service.cloud.SurveyUpdateService;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.io.exception.CodeListImportException;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.manager.exception.SurveyValidationException;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.persistence.SurveyImportException;
import org.openforis.idm.metamodel.xml.IdmlParseException;

import net.lingala.zip4j.ZipFile;

/**
 * A cloud project opened again with a changed survey that Collect cannot import: at the start the files of before are
 * put back and their survey loaded, rather than Collect Earth not starting. Any other project fails as before.
 */
class EarthSurveyServiceUpdateTest {

	private static final String BEFORE = "<survey>before</survey>";
	private static final String AFTER = "<survey>after</survey>";
	private static final String SETTINGS = "survey_name=forest\nmetadata_file=${project_path}/placemark.idm.xml\n";

	@TempDir
	File projects;

	private File project;
	private final LocalPropertiesService properties = new LocalPropertiesService(new Properties());
	private final SurveyManager surveyManager = mock(SurveyManager.class);
	private final NoticeService notices = new NoticeService();
	private final EarthSurveyService service = new EarthSurveyService();
	private final CollectSurvey survey = mock(CollectSurvey.class);

	private static void set(Object target, Class<?> owner, String name, Object value) throws Exception {
		Field field = owner.getDeclaredField(name);
		field.setAccessible(true);
		field.set(target, value);
	}

	private static String read(File file) throws IOException {
		return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
	}

	private static String revision(String survey) {
		return SurveyRevision.of(survey.getBytes(StandardCharsets.UTF_8));
	}

	@BeforeEach
	void start() throws Exception {
		project = new File(projects, "forest");
		Files.createDirectories(project.toPath());
		Files.write(new File(project, "project_definition.properties").toPath(), SETTINGS.getBytes(StandardCharsets.UTF_8));
		Files.write(new File(project, "placemark.idm.xml").toPath(), BEFORE.getBytes(StandardCharsets.UTF_8));
		properties.setValue(EarthProperty.METADATA_FILE, new File(project, "placemark.idm.xml").getAbsolutePath());
		properties.saveCloudBinding(new CloudBinding(project.getAbsolutePath(), "https://a.org", "p1", "Forest", "ana"));
		EarthProjectsService earthProjects = new EarthProjectsService();
		earthProjects.init(properties);
		set(service, AbstractEarthSurveyService.class, "localPropertiesService", properties);
		set(service, AbstractEarthSurveyService.class, "surveyManager", surveyManager);
		set(service, EarthSurveyService.class, "notices", notices);
		set(service, EarthSurveyService.class, "projects", earthProjects);
		when(survey.getUri()).thenReturn("http://forest");
		when(survey.getContext()).thenReturn(mock(CollectSurveyContext.class));
		when(surveyManager.unmarshalSurvey(any(InputStream.class), anyBoolean(), anyBoolean())).thenReturn(survey);
		when(surveyManager.getByUri("http://forest")).thenReturn(survey);
	}

	/** What Collect 4.0's SurveyManager throws for an IDML it cannot parse (its constructors are package-private) */
	private static IdmlParseException idmlParseException(String message) throws Exception {
		java.lang.reflect.Constructor<IdmlParseException> constructor = IdmlParseException.class.getDeclaredConstructor(String.class, Throwable.class);
		constructor.setAccessible(true);
		return constructor.newInstance(message, null);
	}

	/** Collect takes the survey before, not the changed one: as SurveyManager.updateModel says it, the parse error wrapped */
	private void collectRefusesTheChangedSurvey() throws Exception {
		SurveyImportException refused = new SurveyImportException(idmlParseException("Error importing survey: the node 'land_use' changed its type"));
		when(surveyManager.updateModel(any(File.class), anyBoolean(), anyBoolean())).thenAnswer(i -> {
			if (read(i.getArgument(0)).equals(AFTER)) {
				throw refused;
			}
			return survey;
		});
	}

	/** The changed survey taken: the project file unzipped over the folder, what it replaced kept (CloudService) */
	private void openedAgainWithTheChangedSurvey() throws Exception {
		File cep = new File(projects, "forest.cep");
		try (java.util.zip.ZipOutputStream out = new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(cep))) {
			out.putNextEntry(new java.util.zip.ZipEntry("project_definition.properties"));
			out.write((SETTINGS + "web_form=generated\n").getBytes(StandardCharsets.UTF_8));
			out.putNextEntry(new java.util.zip.ZipEntry("placemark.idm.xml"));
			out.write(AFTER.getBytes(StandardCharsets.UTF_8));
		}
		SurveyUpdateBackup.keep(cep, project);
		try (ZipFile zip = new ZipFile(cep)) {
			zip.extractAll(project.getAbsolutePath());
		}
	}

	@Test
	void aChangedSurveyCollectCannotImportPutsTheOneBeforeBack() throws Exception {
		collectRefusesTheChangedSurvey();
		openedAgainWithTheChangedSurvey();
		properties.setValue(EarthProperty.SAMPLE_FILE, "/data/cloud/p1/my-plots.csv");

		service.afterPropertiesSet();

		assertEquals(BEFORE, read(new File(project, "placemark.idm.xml")));
		assertEquals(SETTINGS, read(new File(project, "project_definition.properties")));
		assertSame(survey, service.getCollectSurvey());
		assertEquals(revision(BEFORE), service.getLoadedSurveyRevision());
		assertFalse(SurveyUpdateBackup.isPending(project));
		// The person's plots stay the plots file
		assertEquals("/data/cloud/p1/my-plots.csv", properties.getValue(EarthProperty.SAMPLE_FILE));
		// Not offered again until the coordinator changes it again
		CloudBinding binding = properties.getCloudBinding();
		assertEquals(revision(BEFORE), binding.surveyRevision);
		assertEquals(revision(AFTER), binding.surveyRevisionRefused);
		List<Map<String, Object>> said = notices.pending();
		assertEquals(1, said.size());
		assertEquals(SurveyUpdateService.RESULT_NOTICE, said.get(0).get("kind"));
		assertTrue(String.valueOf(said.get(0).get("message")).contains("changed its type"));
	}

	@Test
	void aChangedSurveyThatDoesNotValidateToo() throws Exception {
		when(surveyManager.updateModel(any(File.class), anyBoolean(), anyBoolean())).thenAnswer(i -> {
			if (read(i.getArgument(0)).equals(AFTER)) {
				throw new SurveyValidationException("The survey is not valid");
			}
			return survey;
		});
		openedAgainWithTheChangedSurvey();
		service.afterPropertiesSet();
		assertEquals(BEFORE, read(new File(project, "placemark.idm.xml")));
		assertSame(survey, service.getCollectSurvey());
	}

	@Test
	void aChangedSurveyLoadedIsKeptAndTheBackupDeleted() throws Exception {
		when(surveyManager.updateModel(any(File.class), anyBoolean(), anyBoolean())).thenReturn(survey);
		openedAgainWithTheChangedSurvey();
		service.afterPropertiesSet();
		assertEquals(AFTER, read(new File(project, "placemark.idm.xml")));
		assertEquals(revision(AFTER), service.getLoadedSurveyRevision());
		assertFalse(SurveyUpdateBackup.isPending(project));
		assertFalse(SurveyUpdateBackup.folderOf(project).exists());
		assertTrue(notices.pending().isEmpty());
	}

	/**
	 * Review: a failure that has nothing to do with the survey (the database busy at that start, a file held by an
	 * antivirus) is tried again after a moment, and the changed survey loaded then.
	 */
	@Test
	void aPassingFailureIsTriedAgain() throws Exception {
		service.retryWaitMs = 0;
		int[] calls = { 0 };
		when(surveyManager.updateModel(any(File.class), anyBoolean(), anyBoolean())).thenAnswer(i -> {
			if (calls[0]++ == 0) {
				throw new org.springframework.dao.CannotAcquireLockException("[SQLITE_BUSY] The database file is locked");
			}
			return survey;
		});
		openedAgainWithTheChangedSurvey();
		service.afterPropertiesSet();
		assertEquals(AFTER, read(new File(project, "placemark.idm.xml")));
		assertEquals(revision(AFTER), service.getLoadedSurveyRevision());
		assertFalse(SurveyUpdateBackup.isPending(project));
		assertNull(properties.getCloudBinding().surveyRevisionRefused);
		assertTrue(notices.pending().isEmpty());
	}

	/**
	 * Review: a failure that is not the survey's, and lasts: the files of before are put back as for a survey Collect
	 * cannot use, but the change is not refused for good: it is offered again.
	 */
	@Test
	void aFailureThatIsNotTheSurveysPutsTheFilesBackAndTheChangeIsOfferedAgain() throws Exception {
		service.retryWaitMs = 0;
		when(surveyManager.updateModel(any(File.class), anyBoolean(), anyBoolean())).thenAnswer(i -> {
			if (read(i.getArgument(0)).equals(AFTER)) {
				// the survey file held by an antivirus, say
				throw new IOException("The process cannot access the file because it is being used by another process");
			}
			return survey;
		});
		openedAgainWithTheChangedSurvey();
		service.afterPropertiesSet();
		assertEquals(BEFORE, read(new File(project, "placemark.idm.xml")));
		assertSame(survey, service.getCollectSurvey());
		CloudBinding binding = properties.getCloudBinding();
		assertEquals(revision(BEFORE), binding.surveyRevision);
		assertNull(binding.surveyRevisionRefused, "not refused: offered again");
		java.lang.reflect.Method decide = SurveyUpdateService.class.getDeclaredMethod("decide", String.class, String.class, String.class, String.class);
		decide.setAccessible(true);
		assertEquals("ASK", String.valueOf(decide.invoke(null, binding.surveyRevision, revision(AFTER), null, binding.surveyRevisionRefused)));
		List<Map<String, Object>> said = notices.pending();
		assertEquals(1, said.size());
		assertTrue(String.valueOf(said.get(0).get("message")).startsWith(
				org.openforis.collect.earth.app.view.Messages.getString("CloudSurvey.notLoaded").substring(0, 20)), String.valueOf(said.get(0).get("message")));
	}

	/** What Collect 4.0.111 throws for a survey of its own making, told apart from the rest */
	@Test
	void theSurveysOwnErrorsAreToldApart() throws Exception {
		assertTrue(EarthSurveyService.isSurveyError(new SurveyValidationException("not valid")));
		assertTrue(EarthSurveyService.isSurveyError(idmlParseException("bad XML")));
		assertTrue(EarthSurveyService.isSurveyError(new SurveyImportException(idmlParseException("bad XML"))));
		assertTrue(EarthSurveyService.isSurveyError(new SurveyImportException(new CodeListImportException("bad code list"))));
		assertFalse(EarthSurveyService.isSurveyError(new SurveyImportException("Could not find survey to update")));
		assertFalse(EarthSurveyService.isSurveyError(new org.springframework.dao.CannotAcquireLockException("busy")));
		assertFalse(EarthSurveyService.isSurveyError(new java.io.FileNotFoundException("held")));
		assertFalse(EarthSurveyService.isSurveyError(new IllegalStateException("x", new java.sql.SQLException("busy"))));
	}

	/** The reason said is the cause's words, not the name of the cause Collect wraps */
	@Test
	void theReasonIsTheCausesWords() throws Exception {
		assertEquals("bad XML at line 3", EarthSurveyService.reasonOf(new SurveyImportException(idmlParseException("bad XML at line 3"))));
		assertEquals("not valid", EarthSurveyService.reasonOf(new SurveyValidationException("not valid")));
		assertEquals("IllegalStateException", EarthSurveyService.reasonOf(new IllegalStateException()));
	}

	/** No project opened again: a survey Collect cannot import fails the start as before, one that does not validate is logged */
	@Test
	void anyOtherFailureIsAsBefore() throws Exception {
		Files.write(new File(project, "placemark.idm.xml").toPath(), AFTER.getBytes(StandardCharsets.UTF_8));
		collectRefusesTheChangedSurvey();
		assertThrows(SurveyImportException.class, service::afterPropertiesSet);
		assertNull(service.getCollectSurvey());

		when(surveyManager.updateModel(any(File.class), anyBoolean(), anyBoolean())).thenThrow(new SurveyValidationException("not valid"));
		service.afterPropertiesSet();
		assertNull(service.getCollectSurvey());
		assertEquals(AFTER, read(new File(project, "placemark.idm.xml")));
		assertTrue(notices.pending().isEmpty());
	}
}

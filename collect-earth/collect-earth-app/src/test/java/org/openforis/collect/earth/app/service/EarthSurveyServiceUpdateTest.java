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
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.manager.exception.SurveyValidationException;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.persistence.SurveyImportException;

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

	/** Collect takes the survey before, not the changed one */
	private void collectRefusesTheChangedSurvey() throws Exception {
		when(surveyManager.updateModel(any(File.class), anyBoolean(), anyBoolean())).thenAnswer(i -> {
			if (read(i.getArgument(0)).equals(AFTER)) {
				throw new SurveyImportException("Error importing survey: the node 'land_use' changed its type");
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

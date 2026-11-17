package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Properties;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

public class EarthProjectsServiceTest {

	@TempDir
	File folder;

	@Test
	public void aFolderBoundToACloudProjectIsInCloudModeAnyOtherUsesThisComputersDatabase() {
		assertEquals(CollectDBDriver.SQLITE, EarthProjectsService.driverAfterLoading(CollectDBDriver.CLOUD, false));
		assertEquals(CollectDBDriver.CLOUD, EarthProjectsService.driverAfterLoading(CollectDBDriver.SQLITE, true));
		assertEquals(CollectDBDriver.CLOUD, EarthProjectsService.driverAfterLoading(CollectDBDriver.CLOUD, true));
		assertEquals(CollectDBDriver.SQLITE, EarthProjectsService.driverAfterLoading(CollectDBDriver.SQLITE, false));
	}

	@Test
	public void anOfficeComputerGoesBackToItsPostgreSqlWhenAProjectThatIsNotACloudOneIsOpened() {
		assertEquals(CollectDBDriver.POSTGRESQL, EarthProjectsService.driverAfterLoading(CollectDBDriver.CLOUD, false, true));
		assertEquals(CollectDBDriver.SQLITE, EarthProjectsService.driverAfterLoading(CollectDBDriver.CLOUD, false, false));
		assertEquals(CollectDBDriver.CLOUD, EarthProjectsService.driverAfterLoading(CollectDBDriver.CLOUD, true, true));
		// back on the office's database, the cloud project opened again is in the cloud mode again
		assertEquals(CollectDBDriver.CLOUD, EarthProjectsService.driverAfterLoading(CollectDBDriver.POSTGRESQL, true, true));
		assertEquals(CollectDBDriver.POSTGRESQL, EarthProjectsService.driverAfterLoading(CollectDBDriver.POSTGRESQL, false, true));
	}

	@Test
	public void leavesPostgreSqlAsItIs() {
		assertEquals(CollectDBDriver.POSTGRESQL, EarthProjectsService.driverAfterLoading(CollectDBDriver.POSTGRESQL, true));
		assertEquals(CollectDBDriver.POSTGRESQL, EarthProjectsService.driverAfterLoading(CollectDBDriver.POSTGRESQL, false));
	}

	private File project(String name) throws IOException {
		return project(name, "");
	}

	private File project(String name, String moreProperties) throws IOException {
		File project = new File(folder, name);
		assertTrue(project.mkdir());
		Files.write(new File(project, "project_definition.properties").toPath(),
				("survey_name=" + name + "\nmetadata_file=${project_path}/placemark.idm.xml\n" + moreProperties).getBytes(StandardCharsets.UTF_8));
		return project;
	}

	/** A project file's Explorer configuration is the survey's: loaded with it, and not kept for a project without one. */
	@Test
	public void theExplorerConfigurationOfAProjectFileIsLoadedAndNotKeptForTheNextProject() throws IOException {
		LocalPropertiesService properties = new LocalPropertiesService(new Properties());
		EarthProjectsService projects = new EarthProjectsService();
		projects.init(properties);
		File dry = project("dry", "explorer_config={\"v\"\\:1,\"layers\"\\:[{\"type\"\\:\"landsat\"}]}\n");
		File plain = project("plain");

		assertTrue(projects.loadProjectInFolder(dry));
		assertEquals("{\"v\":1,\"layers\":[{\"type\":\"landsat\"}]}", properties.getValue(EarthProperty.EXPLORER_CONFIG));

		assertTrue(projects.loadProjectInFolder(plain));
		assertEquals("", properties.getValue(EarthProperty.EXPLORER_CONFIG));
	}

	/** Two cloud projects on two servers and a local one, opened in turn: each keeps its own mode, server and account. */
	@Test
	public void switchingBetweenTwoCloudProjectsAndALocalOneKeepsEachOnesMode() throws IOException {
		LocalPropertiesService properties = new LocalPropertiesService(new Properties());
		EarthProjectsService projects = new EarthProjectsService();
		projects.init(properties);
		File kenya = project("kenya");
		File peru = project("peru");
		File local = project("local");
		properties.saveCloudBinding(new CloudBinding(kenya.getPath(), "https://a.org/", "p1", "Kenya 2025", "ana"));
		properties.saveCloudBinding(new CloudBinding(peru.getPath(), "https://b.org", "p2", "Peru", "bob"));
		properties.saveCloudToken("https://a.org", "ana", "token-a");
		properties.saveCloudToken("https://b.org", "bob", "token-b");

		assertTrue(projects.loadProjectInFolder(kenya));
		assertEquals(CollectDBDriver.CLOUD, properties.getCollectDBDriver());
		assertEquals("https://a.org", properties.getCloudSyncUrl());
		assertEquals("p1", properties.getCloudProjectId());
		assertEquals("token-a", properties.getCloudSyncToken());
		assertEquals("ana", properties.getOperator());

		properties.saveOperator("Someone local");
		assertTrue(projects.loadProjectInFolder(local));
		assertEquals(CollectDBDriver.SQLITE, properties.getCollectDBDriver());
		assertNull(properties.getCloudBinding());
		assertEquals("Someone local", properties.getOperator());

		assertTrue(projects.loadProjectInFolder(peru));
		assertEquals(CollectDBDriver.CLOUD, properties.getCollectDBDriver());
		assertEquals("https://b.org", properties.getCloudSyncUrl());
		assertEquals("p2", properties.getCloudProjectId());
		assertEquals("token-b", properties.getCloudSyncToken());
		assertEquals("bob", properties.getOperator());

		// Back to the first: its binding was never touched by the second
		assertTrue(projects.loadProjectInFolder(kenya));
		assertEquals(CollectDBDriver.CLOUD, properties.getCollectDBDriver());
		assertEquals("p1", properties.getCloudProjectId());
		assertEquals("token-a", properties.getCloudSyncToken());
		assertEquals("ana", properties.getOperator());
		assertEquals(2, properties.getCloudBindings().size());
	}

	private File projectFile(String name, String settings) throws IOException {
		File cep = new File(folder, name + ".cep");
		try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(cep.toPath()))) {
			zip.putNextEntry(new ZipEntry("project_definition.properties"));
			zip.write(settings.getBytes(StandardCharsets.ISO_8859_1));
			zip.closeEntry();
		}
		return cep;
	}

	/**
	 * A project file for working alone, on a computer that has its survey as a cloud project, is refused in plain words:
	 * unzipped into the cloud project's folder it would stay the cloud project and its plots would be ignored.
	 */
	@Test
	public void aProjectFileForWorkingAloneIsRefusedWhereTheSurveyIsACloudProject() throws IOException {
		LocalPropertiesService properties = new LocalPropertiesService(new Properties());
		EarthProjectsService projects = new EarthProjectsService();
		projects.init(properties);
		File alone = projectFile("alone", "survey_name=mapathon_standalone_test\ncloud_standalone=true\n");
		File updated = projectFile("updated", "survey_name=mapathon_standalone_test\n");

		assertTrue(EarthProjectsService.madeForWorkingAlone(alone));
		assertNull(projects.refusalOf(alone)); // a computer that never joined opens it
		properties.saveCloudBinding(new CloudBinding(projects.projectFolderFor(alone).getPath(), "https://a.org", "p1", "Mapathon", "m2"));
		String refusal = projects.refusalOf(alone);
		assertNotNull(refusal);
		assertTrue(refusal.contains("Mapathon"), refusal);
		// refused before anything is unzipped over the cloud project's folder
		assertThrows(IOException.class, () -> projects.loadCompressedProjectFile(alone));
		// a project file of the cloud project itself (a coordinator's updated one) is still opened there
		assertNull(projects.refusalOf(updated));
	}
}

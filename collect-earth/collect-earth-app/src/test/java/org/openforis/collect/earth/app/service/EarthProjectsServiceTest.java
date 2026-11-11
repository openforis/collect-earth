package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Properties;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;

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
	public void leavesPostgreSqlAsItIs() {
		assertEquals(CollectDBDriver.POSTGRESQL, EarthProjectsService.driverAfterLoading(CollectDBDriver.POSTGRESQL, true));
		assertEquals(CollectDBDriver.POSTGRESQL, EarthProjectsService.driverAfterLoading(CollectDBDriver.POSTGRESQL, false));
	}

	private File project(String name) throws IOException {
		File project = new File(folder, name);
		assertTrue(project.mkdir());
		Files.write(new File(project, "project_definition.properties").toPath(),
				("survey_name=" + name + "\nmetadata_file=${project_path}/placemark.idm.xml\n").getBytes(StandardCharsets.UTF_8));
		return project;
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
}

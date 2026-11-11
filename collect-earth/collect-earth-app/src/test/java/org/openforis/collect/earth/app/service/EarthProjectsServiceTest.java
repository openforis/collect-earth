package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.File;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;

public class EarthProjectsServiceTest {

	private final File kenya = new File("projects/kenya");
	private final File peru = new File("projects/peru");

	@Test
	public void anotherProjectOpenedAfterJoiningUsesThisComputersDatabase() {
		assertEquals(CollectDBDriver.SQLITE, EarthProjectsService.driverAfterLoading(CollectDBDriver.CLOUD, kenya.getPath(), "p1", peru));
		// joined before the folder was recorded: no project is the cloud one
		assertEquals(CollectDBDriver.SQLITE, EarthProjectsService.driverAfterLoading(CollectDBDriver.CLOUD, "", "p1", peru));
	}

	@Test
	public void theJoinedProjectOpenedAgainSyncsAgain() {
		assertEquals(CollectDBDriver.CLOUD, EarthProjectsService.driverAfterLoading(CollectDBDriver.SQLITE, kenya.getAbsolutePath(), "p1", kenya));
		assertEquals(CollectDBDriver.CLOUD, EarthProjectsService.driverAfterLoading(CollectDBDriver.CLOUD, kenya.getPath(), "p1", kenya));
		// not without the cloud project it belongs to
		assertEquals(CollectDBDriver.SQLITE, EarthProjectsService.driverAfterLoading(CollectDBDriver.SQLITE, kenya.getPath(), null, kenya));
	}

	@Test
	public void leavesPostgreSqlAsItIs() {
		assertEquals(CollectDBDriver.POSTGRESQL, EarthProjectsService.driverAfterLoading(CollectDBDriver.POSTGRESQL, kenya.getPath(), "p1", kenya));
		assertEquals(CollectDBDriver.POSTGRESQL, EarthProjectsService.driverAfterLoading(CollectDBDriver.POSTGRESQL, kenya.getPath(), "p1", peru));
	}
}

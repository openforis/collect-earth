package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService.PlotStatus;

/** What {@link LeafletMapController} tells the plots map. */
public class LeafletMapControllerTest {

	@Test
	public void theStatusesAreNamedAsThePlotsMapNamesThem() {
		assertEquals("saved", LeafletMapController.statusName(PlotStatus.SUBMITTED));
		assertEquals("partial", LeafletMapController.statusName(PlotStatus.IN_PROGRESS));
		// a record with nothing answered, as opening a plot stored before, is not started
		assertEquals("empty", LeafletMapController.statusName(PlotStatus.NOT_STARTED));
	}

	@Test
	public void thePlotsVersionChangesWithThePlotFile(@TempDir Path folder) throws Exception {
		assertEquals("", LeafletMapController.plotsVersion(null));
		assertEquals("", LeafletMapController.plotsVersion(" "));
		assertEquals("", LeafletMapController.plotsVersion(folder.resolve("missing.csv").toString()));
		File all = Files.writeString(folder.resolve("all.csv"), "id,x,y\n").toFile();
		File assigned = Files.writeString(folder.resolve("assigned.csv"), "id,x,y\n").toFile();
		String version = LeafletMapController.plotsVersion(all.getPath());
		assertEquals(version, LeafletMapController.plotsVersion(all.getPath()));
		// another file, as the assigned one chosen in the settings
		assertNotEquals(version, LeafletMapController.plotsVersion(assigned.getPath()));
		// the same file, changed
		all.setLastModified(all.lastModified() + 5000);
		assertNotEquals(version, LeafletMapController.plotsVersion(all.getPath()));
	}
}

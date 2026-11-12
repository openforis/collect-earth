package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The plots file KmlGeneratorService uses instead of one that is not there: a file of the same path in the Collect Earth
 * data folder, but never in a cloud project, whose plots file is one its server assigned.
 */
public class PlotFileElsewhereTest {

	@Test
	public void aMissingPlotsFileIsLookedForInTheDataFolderOutsideACloudProject(@TempDir Path dataFolder) throws Exception {
		File missing = new File("projects/survey/plots.csv");
		File inDataFolder = dataFolder.resolve("projects/survey/plots.csv").toFile();
		Files.createDirectories(inDataFolder.getParentFile().toPath());
		Files.write(inDataFolder.toPath(), "id,lat,lon\n".getBytes());
		String prefix = dataFolder + File.separator;
		assertEquals(inDataFolder.getAbsoluteFile(), KmlGeneratorService.plotFileElsewhere(missing, prefix, false).getAbsoluteFile());
		// A cloud project keeps the file it has, even missing: another one would show plots not assigned
		assertNull(KmlGeneratorService.plotFileElsewhere(missing, prefix, true));
		// Nothing to replace a file that is there, or with nothing in the data folder
		assertNull(KmlGeneratorService.plotFileElsewhere(inDataFolder, prefix, false));
		assertNull(KmlGeneratorService.plotFileElsewhere(new File("other/none.csv"), prefix, false));
	}
}

package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;

/**
 * What a project needs before its plots are shown, now that no KML is made for Google Earth Pro: its plot file checked,
 * and the files of its own form copied where the server serves them; a project file without a KML template (none is
 * needed any more) loads all the same, and what Collect Earth 1.x left for Google Earth Pro is deleted.
 */
public class PrepareProjectFilesTest {

	@TempDir
	Path folder;

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final KmlGeneratorService service = new KmlGeneratorService();
	private File project;
	private File generated;

	@BeforeEach
	public void setUp() throws Exception {
		service.localPropertiesService = properties;
		project = Files.createDirectories(folder.resolve("project")).toFile();
		generated = Files.createDirectories(folder.resolve("generated")).toFile();
		write(new File(project, "plots.csv"), "id,YCoordinate,XCoordinate\n1,10,20\n");
		write(new File(project, "balloon.html"), "<html></html>");
		when(properties.getCsvFile()).thenReturn(new File(project, "plots.csv").getPath());
		when(properties.getBalloonFile()).thenReturn(new File(project, "balloon.html").getPath());
		// an old project's KML template, which is not there: no longer needed
		when(properties.getTemplateFile()).thenReturn(new File(project, "kml_template.fmt").getPath());
	}

	@Test
	public void theFormsFilesAreCopiedAndOnlyTheChangedOnesAgain() throws Exception {
		File script = write(new File(project, "earthFiles/js/earth.js"), "one");
		write(new File(project, "webFiles/web.css"), "body{}");
		service.prepareProjectFiles(generated);
		File copied = new File(generated, "earthFiles/js/earth.js");
		assertEquals("one", read(copied));
		assertEquals("body{}", read(new File(generated, "webFiles/web.css")));

		// unchanged: not copied again (a file changed in the generated folder stays as it is)
		write(copied, "own");
		copied.setLastModified(script.lastModified());
		service.prepareProjectFiles(generated);
		assertEquals("own", read(copied));
		// changed in the project: copied
		write(script, "three!");
		service.prepareProjectFiles(generated);
		assertEquals("three!", read(copied));
	}

	@Test
	public void aProjectWithoutFormFilesOrBalloonNeedsNothingCopied() throws Exception {
		service.prepareProjectFiles(generated);
		assertFalse(new File(generated, "earthFiles").exists());
		when(properties.getBalloonFile()).thenReturn("");
		service.prepareProjectFiles(generated);
	}

	@Test
	public void aMissingPlotFileIsSaidWithItsPath() throws Exception {
		File missing = new File(project, "gone <b>.csv");
		when(properties.getCsvFile()).thenReturn(missing.getPath());
		KmlGenerationException e = assertThrows(KmlGenerationException.class, () -> service.prepareProjectFiles(generated));
		assertTrue(e.getMessage().contains("gone &lt;b&gt;.csv"), e.getMessage());
		when(properties.getCsvFile()).thenReturn(" ");
		assertThrows(KmlGenerationException.class, () -> service.prepareProjectFiles(generated));
	}

	@Test
	public void whatCollectEarthOneLeftForGoogleEarthProIsDeleted() throws Exception {
		File kmz = write(new File(generated, "gePlugin.kmz"), "PK");
		File kml = write(new File(generated, "plots.kml"), "<kml/>");
		File other = write(new File(generated, "applicationContext.xml"), "<beans/>");
		service.prepareProjectFiles(generated);
		assertFalse(kmz.exists());
		assertFalse(kml.exists());
		assertTrue(other.exists());
	}

	private static File write(File file, String text) throws Exception {
		Files.createDirectories(file.getParentFile().toPath());
		Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
		return file;
	}

	private static String read(File file) throws Exception {
		return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
	}
}

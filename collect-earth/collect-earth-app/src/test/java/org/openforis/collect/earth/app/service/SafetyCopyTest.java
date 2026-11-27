package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Properties;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

/** The copies taken before a step that could lose data: what is in them, and that each is told about once. */
public class SafetyCopyTest {

	@TempDir
	File dir;

	@Test
	public void copiesTheDatabaseTheSettingsAndTheProjectFolderIntoOneZipThatIsWhole() throws Exception {
		File database = write("collectEarthDatabase.db", "records");
		File settings = write("earth.properties", "operator=ana");
		File project = new File(dir, "projects/collect_earth_initial_2025");
		Files.createDirectories(new File(project, "grid").toPath());
		Files.write(new File(project, "project_definition.properties").toPath(), "survey_name=collect_earth_initial_2025".getBytes(StandardCharsets.UTF_8));
		Files.write(new File(project, "grid/plots.csv").toPath(), "id,lat,lon".getBytes(StandardCharsets.UTF_8));
		File into = new File(dir, "safetyCopies");

		File copy = SafetyCopy.make(into, "before-joining-collect_earth_initial_2025", database, settings, project);

		assertTrue(copy.getName().startsWith("before-joining-collect_earth_initial_2025_"));
		assertTrue(copy.getName().endsWith(".zip"));
		try (ZipFile zip = new ZipFile(copy)) {
			List<String> names = new ArrayList<>();
			Collections.list(zip.entries()).forEach((ZipEntry e) -> names.add(e.getName()));
			Collections.sort(names);
			assertEquals(List.of("collectEarthDatabase.db", "earth.properties", "projects/collect_earth_initial_2025/grid/plots.csv",
					"projects/collect_earth_initial_2025/project_definition.properties"), names);
			assertEquals("records", new String(zip.getInputStream(zip.getEntry("collectEarthDatabase.db")).readAllBytes(), StandardCharsets.UTF_8));
		}
		// Written whole and renamed: no ".part" left
		assertArrayEquals(new String[] { copy.getName() }, into.list());
		// A second copy in the same second does not replace the first
		File again = SafetyCopy.make(into, "before-joining-collect_earth_initial_2025", database, settings, project);
		assertNotEquals(copy, again);
		assertTrue(copy.isFile() && again.isFile());
	}

	@Test
	public void nothingToCopyIsNoCopy() throws Exception {
		File into = new File(dir, "safetyCopies");
		// A new installation: no database yet, no project
		assertNull(SafetyCopy.make(into, "before-collect-earth-2", new File(dir, "none.db"), write("earth.properties", ""), null));
		// An empty database file (created and never used) is nothing either
		assertNull(SafetyCopy.make(into, "before-collect-earth-2", write("empty.db", ""), null, null));
		assertFalse(into.exists());
	}

	@Test
	public void aCopyIsToldAboutOnceAtTheNextStart() {
		LocalPropertiesService properties = new LocalPropertiesService(new Properties());
		File copy = new File(dir, "safetyCopies/before-joining-x_2026-11-27_101500.zip");
		SafetyCopy.tellAtNextStart(properties, SafetyCopy.BEFORE_JOIN, copy, "collect_earth_initial_2025");
		assertArrayEquals(new String[] { SafetyCopy.BEFORE_JOIN, copy.getAbsolutePath(), "collect_earth_initial_2025" }, SafetyCopy.pendingNotice(properties));
		assertNull(SafetyCopy.pendingNotice(properties));
		assertEquals("", properties.getValue(EarthProperty.SAFETY_COPY_NOTICE));
	}

	@Test
	public void whetherTheFirstStartCopyWasTakenIsReadFromTheSettingsFileItself() throws Exception {
		File settings = write("earth.properties", "operator=ana\nsafety_copy_first_start=before-collect-earth-2_2026-11-27_101500.zip\n");
		assertEquals("before-collect-earth-2_2026-11-27_101500.zip", SafetyCopy.rawSetting(settings, "safety_copy_first_start"));
		assertNull(SafetyCopy.rawSetting(write("earth1.properties", "operator=ana\n"), "safety_copy_first_start"));
		assertNull(SafetyCopy.rawSetting(new File(dir, "missing.properties"), "safety_copy_first_start"));
		// Nothing taken this start: nothing remembered, nothing told
		LocalPropertiesService properties = new LocalPropertiesService(new Properties());
		SafetyCopy.rememberFirstStart(properties);
		assertEquals("", properties.getValue(EarthProperty.SAFETY_COPY_FIRST_START));
		assertNull(SafetyCopy.pendingNotice(properties));
	}

	@Test
	public void aNameIsSafeForAFile() {
		assertEquals("before-joining-Kenya-2025-survey", SafetyCopy.safeName("before-joining-Kenya 2025: survey/"));
		assertEquals("copy", SafetyCopy.safeName("///"));
	}

	private File write(String name, String content) throws Exception {
		File file = new File(dir, name);
		Files.write(file.toPath(), content.getBytes(StandardCharsets.UTF_8));
		return file;
	}
}

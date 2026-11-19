package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import net.lingala.zip4j.ZipFile;

/** The files a cloud project opened again replaces, kept until its survey is loaded, and put back when it cannot be. */
class SurveyUpdateBackupTest {

	@TempDir
	File projects;

	private static void write(File file, String text) throws IOException {
		Files.createDirectories(file.getParentFile().toPath());
		Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
	}

	private static String read(File file) throws IOException {
		return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
	}

	private File newProjectFile() throws IOException {
		Map<String, String> entries = new LinkedHashMap<>();
		entries.put("project_definition.properties", "survey_name=forest\nmetadata_file=${project_path}/placemark.idm.xml\nballoon=${project_path}/balloon.html\n");
		entries.put("placemark.idm.xml", "<survey>after</survey>");
		entries.put("balloon.html", "<form>after</form>");
		entries.put("webFiles/new.js", "// new");
		return SurveyRevisionTest.zip(new File(projects, "forest.cep"), entries);
	}

	@Test
	void theFilesReplacedArePutBackAndThoseAddedTakenAway() throws IOException {
		File project = new File(projects, "forest");
		write(new File(project, "project_definition.properties"), "survey_name=forest\nmetadata_file=${project_path}/placemark.idm.xml\n");
		write(new File(project, "placemark.idm.xml"), "<survey>before</survey>");
		write(new File(project, "balloon.html"), "<form>before</form>");
		write(new File(project, "assignments/plots.csv"), "id,x,y");
		File cep = newProjectFile();

		SurveyUpdateBackup.keep(cep, project);
		assertTrue(SurveyUpdateBackup.isPending(project));
		assertFalse(SurveyUpdateBackup.folderOf(project).toPath().startsWith(project.toPath()), "not in the project folder");
		try (ZipFile zip = new ZipFile(cep)) {
			zip.extractAll(project.getAbsolutePath());
		}
		assertEquals("<survey>after</survey>", read(new File(project, "placemark.idm.xml")));

		SurveyUpdateBackup.Restored restored = SurveyUpdateBackup.restore(project);
		assertNotNull(restored);
		assertEquals(SurveyRevision.of("<survey>before</survey>".getBytes(StandardCharsets.UTF_8)), restored.revisionBefore);
		assertEquals(SurveyRevision.of("<survey>after</survey>".getBytes(StandardCharsets.UTF_8)), restored.revisionAfter);
		assertEquals("<survey>before</survey>", read(new File(project, "placemark.idm.xml")));
		assertEquals("<form>before</form>", read(new File(project, "balloon.html")));
		assertTrue(read(new File(project, "project_definition.properties")).indexOf("balloon=") < 0);
		assertFalse(new File(project, "webFiles/new.js").exists(), "added by the project file");
		assertEquals("id,x,y", read(new File(project, "assignments/plots.csv")), "not the project file's: left alone");
		assertFalse(SurveyUpdateBackup.isPending(project));
		assertFalse(SurveyUpdateBackup.folderOf(project).exists());
		assertNull(SurveyUpdateBackup.restore(project), "once");
	}

	@Test
	void nothingIsKeptForAFirstDownload() throws IOException {
		File project = new File(projects, "forest");
		SurveyUpdateBackup.keep(newProjectFile(), project);
		assertFalse(SurveyUpdateBackup.isPending(project));
		assertNull(SurveyUpdateBackup.restore(project));
	}

	@Test
	void aSurveyLoadedDiscardsTheBackup() throws IOException {
		File project = new File(projects, "forest");
		write(new File(project, "placemark.idm.xml"), "<survey>before</survey>");
		SurveyUpdateBackup.keep(newProjectFile(), project);
		assertTrue(SurveyUpdateBackup.isPending(project));
		SurveyUpdateBackup.discard(project);
		assertFalse(SurveyUpdateBackup.isPending(project));
		assertFalse(SurveyUpdateBackup.folderOf(project).exists());
	}
}

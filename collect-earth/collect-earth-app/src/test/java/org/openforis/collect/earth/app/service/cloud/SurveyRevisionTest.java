package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import net.lingala.zip4j.ZipFile;

/** A survey's revision named as the cloud server names it (surveyDesign.ts revisionOf), from the project file or its unzipped survey. */
class SurveyRevisionTest {

	@TempDir
	File folder;

	static File zip(File file, Map<String, String> entries) throws IOException {
		try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(file))) {
			for (Map.Entry<String, String> entry : entries.entrySet()) {
				out.putNextEntry(new ZipEntry(entry.getKey()));
				out.write(entry.getValue().getBytes(StandardCharsets.UTF_8));
				out.closeEntry();
			}
		}
		return file;
	}

	@Test
	void isTheFirst24HexadecimalDigitsOfTheSha256OfTheSurvey() {
		// sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
		assertEquals("ba7816bf8f01cfea414140de", SurveyRevision.of("abc".getBytes(StandardCharsets.UTF_8)));
	}

	@Test
	void theSurveyOfAProjectFileIsTheOneItsPropertiesName() throws IOException {
		Map<String, String> entries = new LinkedHashMap<>();
		entries.put("project_definition.properties", "survey_name=forest\nmetadata_file=${project_path}/survey/forest.idm.xml\n");
		entries.put("placemark.idm.xml", "<survey>not this one</survey>");
		entries.put("survey/forest.idm.xml", "<survey>forest</survey>");
		File cep = zip(new File(folder, "forest.cep"), entries);
		assertEquals(SurveyRevision.of("<survey>forest</survey>".getBytes(StandardCharsets.UTF_8)), SurveyRevision.ofProjectFile(cep));
	}

	@Test
	void elsePlacemarkIdmXml() throws IOException {
		Map<String, String> entries = new LinkedHashMap<>();
		entries.put("project_definition.properties", "survey_name=forest\nmetadata_file=${project_path}/missing.xml\n");
		entries.put("placemark.idm.xml", "<survey>forest</survey>");
		File cep = zip(new File(folder, "forest.cep"), entries);
		assertEquals(SurveyRevision.of("<survey>forest</survey>".getBytes(StandardCharsets.UTF_8)), SurveyRevision.ofProjectFile(cep));
		entries.remove("placemark.idm.xml");
		assertNull(SurveyRevision.ofProjectFile(zip(new File(folder, "none.cep"), entries)));
		assertNull(SurveyRevision.ofProjectFile(new File(folder, "nowhere.cep")));
	}

	/** Unzipped as Collect Earth unzips a project (EarthProjectsService), the survey file has the project file's revision */
	@Test
	void theUnzippedSurveyHasTheRevisionOfTheProjectFile() throws IOException {
		Map<String, String> entries = new LinkedHashMap<>();
		entries.put("project_definition.properties", "survey_name=forest\nmetadata_file=${project_path}/placemark.idm.xml\n");
		entries.put("placemark.idm.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<survey>Forêt\r\n</survey>\n");
		File cep = zip(new File(folder, "forest.cep"), entries);
		File project = new File(folder, "forest");
		try (ZipFile zip = new ZipFile(cep)) {
			zip.extractAll(project.getAbsolutePath());
		}
		assertEquals(SurveyRevision.ofProjectFile(cep), SurveyRevision.ofFile(new File(project, "placemark.idm.xml")));
	}

	@Test
	void theEntryAPropertyNames() {
		assertEquals("placemark.idm.xml", SurveyRevision.entryNamed("${project_path}/placemark.idm.xml"));
		assertEquals("placemark.idm.xml", SurveyRevision.entryNamed("${project_path}placemark.idm.xml"));
		assertEquals("a/b.xml", SurveyRevision.entryNamed("a/b.xml"));
		assertNull(SurveyRevision.entryNamed(" "));
	}
}

package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;

import javax.swing.filechooser.FileFilter;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.NativeFileChooser.Mode;

/** What the dialog is set up with and what it answers; the dialog itself needs a display and is checked by hand. */
public class SwingNativeFileChooserTest {

	@TempDir
	Path folder;

	@Test
	public void theFilterShowsTheExtensionsAndFolders() throws Exception {
		FileFilter filter = SwingNativeFileChooser.filter(Arrays.asList("csv", ".ced"));
		assertEquals("*.csv, *.ced", filter.getDescription());
		assertTrue(filter.accept(new File("plots.CSV")));
		assertTrue(filter.accept(new File("plots.ced")));
		assertFalse(filter.accept(new File("plots.txt")));
		assertTrue(filter.accept(Files.createDirectory(folder.resolve("sub")).toFile()));
	}

	@Test
	public void withoutExtensionsThereIsNoFilter() {
		assertNull(SwingNativeFileChooser.filter(Collections.emptyList()));
		assertNull(SwingNativeFileChooser.filter(Arrays.asList(" ", "")));
	}

	@Test
	public void aSavedFileTakesTheFirstExtensionWhenItHasNoneOfThem() {
		assertEquals(new File("C:/data/export.zip"),
				SwingNativeFileChooser.withExtension(new File("C:/data/export"), Arrays.asList("zip", "collect-data")));
		assertEquals(new File("C:/data/export.v2.zip"),
				SwingNativeFileChooser.withExtension(new File("C:/data/export.v2"), Arrays.asList("zip")));
	}

	@Test
	public void aSavedFileKeepsAnExtensionOfThem() {
		File backup = new File("C:/data/export.Collect-Data");
		assertEquals(backup, SwingNativeFileChooser.withExtension(backup, Arrays.asList("zip", "collect-data")));
	}

	@Test
	public void aSavedFileOfAnyKindIsLeftAsTyped() {
		File typed = new File("C:/data/export");
		assertEquals(typed, SwingNativeFileChooser.withExtension(typed, Collections.emptyList()));
	}

	@Test
	public void aChosenFolderIsRememberedItselfAndAFileByItsFolder() throws Exception {
		File sub = Files.createDirectory(folder.resolve("sub")).toFile();
		assertEquals(sub, SwingNativeFileChooser.folderToRemember(Mode.FOLDER, sub));
		File plots = new File(sub, "plots.csv");
		assertEquals(sub, SwingNativeFileChooser.folderToRemember(Mode.OPEN, plots));
		assertEquals(sub, SwingNativeFileChooser.folderToRemember(Mode.SAVE, plots));
	}

	@Test
	public void aDriveChosenAsFolderIsRemembered() {
		// A root has no parent: remembering its parent used to set a null property, which threw
		File root = File.listRoots()[0];
		assertEquals(root, SwingNativeFileChooser.folderToRemember(Mode.FOLDER, root));
		assertNull(SwingNativeFileChooser.folderToRemember(Mode.OPEN, root));
	}

	@Test
	public void theDialogStartsFromTheSuggestedFolder() throws Exception {
		File suggested = Files.createDirectory(folder.resolve("projects")).toFile();
		assertEquals(suggested, SwingNativeFileChooser.start(suggested.getPath(), null, folder.toFile()));
	}

	@Test
	public void theDialogStartsOnTheSuggestedFileInAFolderThatExists() {
		File suggested = folder.resolve("plots.csv").toFile();
		assertEquals(suggested, SwingNativeFileChooser.start(suggested.getPath(), null, null));
	}

	@Test
	public void aSuggestedNameAloneGoesInTheLastFolderUsed() throws Exception {
		File last = Files.createDirectory(folder.resolve("last")).toFile();
		assertEquals(new File(last, "plots.csv"), SwingNativeFileChooser.start("plots.csv", last.getPath(), null));
		File defaultFolder = folder.toFile();
		assertEquals(new File(defaultFolder, "plots.csv"),
				SwingNativeFileChooser.start("plots.csv", folder.resolve("gone").toString(), defaultFolder));
	}

	@Test
	public void withoutASuggestionTheDialogStartsInTheLastFolderUsed() throws Exception {
		File last = Files.createDirectory(folder.resolve("last")).toFile();
		assertEquals(last, SwingNativeFileChooser.start(null, last.getPath(), null));
		assertNull(SwingNativeFileChooser.start(" ", folder.resolve("gone").toString(), null));
	}
}

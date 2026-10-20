package org.openforis.collect.earth.app.view;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PlainFileSystemViewTest {

	private final PlainFileSystemView view = PlainFileSystemView.INSTANCE;

	@TempDir
	Path folder;

	private static Set<String> names(File[] files) {
		return Arrays.stream(files).map(File::getName).collect(Collectors.toSet());
	}

	@Test
	void listsPlainFilesThatTheShellNeverSees() throws IOException {
		Files.createFile(folder.resolve("plots.csv"));
		Files.createDirectory(folder.resolve("projects"));

		File[] files = view.getFiles(folder.toFile(), false);

		assertEquals(Set.of("plots.csv", "projects"), names(files));
		for (File file : files) {
			// Not a sun.awt.shell.ShellFolder, which is what the default view of Windows returns
			assertEquals(File.class, file.getClass());
		}
	}

	@Test
	void hidesHiddenFilesOnlyWhenAskedTo() throws IOException {
		Files.createFile(folder.resolve("visible.csv"));
		Path hidden = Files.createFile(folder.resolve(".hidden"));
		try {
			// Hidden on Windows is an attribute; elsewhere the leading dot is enough
			Files.setAttribute(hidden, "dos:hidden", true);
		} catch (UnsupportedOperationException | IllegalArgumentException notDos) {
			// not a DOS file system
		}

		assertEquals(Set.of("visible.csv"), names(view.getFiles(folder.toFile(), true)));
		assertEquals(Set.of("visible.csv", ".hidden"), names(view.getFiles(folder.toFile(), false)));
	}

	@Test
	void aFolderThatIsNotThereHasNoFiles() {
		assertEquals(0, view.getFiles(folder.resolve("missing").toFile(), false).length);
	}

	// Resolving shortcuts is what the shell fails at
	@Test
	void neverResolvesShortcuts() throws IOException {
		File shortcut = Files.createFile(folder.resolve("broken.lnk")).toFile();

		assertFalse(view.isLink(shortcut));
		assertNull(view.getLinkLocation(shortcut));
	}

	@Test
	void createsNewFoldersWithoutOverwritingExistingOnes() throws IOException {
		File first = view.createNewFolder(folder.toFile());
		File second = view.createNewFolder(folder.toFile());

		assertTrue(first.isDirectory());
		assertTrue(second.isDirectory());
		assertNotEquals(first, second);
	}

	@Test
	void navigatesWithTheParentsOfTheFileSystem() {
		File child = folder.resolve("projects").toFile();

		assertEquals(folder.toFile(), view.getParentDirectory(child));
		assertTrue(view.isTraversable(folder.toFile()));
		for (File root : view.getRoots()) {
			assertTrue(view.isFileSystemRoot(root));
			assertFalse(view.getSystemDisplayName(root).isEmpty(), "A drive has no name of its own, its path is shown instead");
		}
	}
}

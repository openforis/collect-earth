package org.openforis.collect.earth.app.desktop;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** JNA's library copied once into the data folder, and JNA pointed at it. */
public class JnaDispatchLibraryTest {

	private static final byte[] LIBRARY = { 1, 2, 3 };

	@TempDir
	File temp;

	private String before;
	private final AtomicInteger reads = new AtomicInteger();

	private final Callable<InputStream> library = () -> {
		reads.incrementAndGet();
		return new ByteArrayInputStream(LIBRARY);
	};

	@BeforeEach
	public void clearProperty() {
		before = System.getProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY);
		System.clearProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY);
	}

	@AfterEach
	public void restoreProperty() {
		if (before == null) {
			System.clearProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY);
		} else {
			System.setProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY, before);
		}
	}

	@Test
	public void copiesTheLibraryOnceAndPointsJnaAtIt() throws IOException {
		File folder = new File(temp, "native/jna-1/win32-x86-64");

		JnaDispatchLibrary.useCopyIn(folder, "jnidispatch.dll", library);

		assertEquals(folder.getAbsolutePath(), System.getProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY));
		assertArrayEquals(LIBRARY, Files.readAllBytes(new File(folder, "jnidispatch.dll").toPath()));
		assertEquals(1, folder.list().length, "no temporary file is left");

		// The next start finds it there
		System.clearProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY);
		JnaDispatchLibrary.useCopyIn(folder, "jnidispatch.dll", library);

		assertEquals(1, reads.get());
		assertEquals(folder.getAbsolutePath(), System.getProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY));
	}

	@Test
	public void theLibraryOfThisPlatformComesFromTheJnaJar() {
		JnaDispatchLibrary.useCopyIn(temp);

		File folder = new File(System.getProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY));
		assertEquals(new File(temp, "native").getAbsolutePath(), folder.getParentFile().getParent());
		assertEquals(1, folder.listFiles().length);
		assertTrue(folder.listFiles()[0].length() > 0);
	}

	@Test
	public void aPathAlreadySetIsKept() {
		System.setProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY, "elsewhere");

		JnaDispatchLibrary.useCopyIn(new File(temp, "jna"), "jnidispatch.dll", library);

		assertEquals("elsewhere", System.getProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY));
		assertEquals(0, reads.get());
	}

	@Test
	public void whenTheCopyFailsJnaUnpacksItAsBefore() throws IOException {
		File notAFolder = new File(temp, "file");
		Files.write(notAFolder.toPath(), LIBRARY);

		JnaDispatchLibrary.useCopyIn(notAFolder, "jnidispatch.dll", library);
		assertNull(System.getProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY));

		// No library for this platform in the jar
		JnaDispatchLibrary.useCopyIn(new File(temp, "jna"), "jnidispatch.dll", () -> null);
		assertNull(System.getProperty(JnaDispatchLibrary.BOOT_PATH_PROPERTY));
		assertEquals(0, new File(temp, "jna").list().length, "no temporary file is left");
	}
}

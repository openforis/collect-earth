package org.openforis.collect.earth.app.desktop;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.Callable;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.sun.jna.Native;
import com.sun.jna.Platform;

/**
 * JNA's native library, copied once into the Collect Earth data folder and loaded from there. Left to itself JNA
 * unpacks it into the temporary folder at every start and deletes it after loading it, and a virus scanner holding the
 * new DLL kept that delete waiting for 20 seconds. Any failure leaves JNA to unpack it as before: never jna.nounpack,
 * as without JNA the cloud token would stay in plain text (WindowsDpapiProtector).
 */
final class JnaDispatchLibrary {

	static final String BOOT_PATH_PROPERTY = "jna.boot.library.path"; //$NON-NLS-1$

	private static final Logger logger = LoggerFactory.getLogger(JnaDispatchLibrary.class);

	private JnaDispatchLibrary() {
	}

	/** Before anything uses JNA: once Native is loaded, its library is loaded too. */
	static void useCopyIn(File dataFolder) {
		// The name JNA looks for in jna.boot.library.path (Native.loadNativeDispatchLibrary)
		final String fileName = System.mapLibraryName("jnidispatch").replace(".dylib", ".jnilib"); //$NON-NLS-1$ //$NON-NLS-2$
		// Platform does not load Native, and Native.VERSION is a constant the compiler copies here: neither unpacks
		// anything. One folder per version, as the library of another JNA version is refused
		final File folder = new File(dataFolder, "native" + File.separator + "jna-" + Native.VERSION + File.separator //$NON-NLS-1$ //$NON-NLS-2$
				+ Platform.RESOURCE_PREFIX);
		useCopyIn(folder, fileName,
				() -> Platform.class.getResourceAsStream("/com/sun/jna/" + Platform.RESOURCE_PREFIX + "/" + fileName)); //$NON-NLS-1$ //$NON-NLS-2$
	}

	static void useCopyIn(File folder, String fileName, Callable<InputStream> library) {
		if (System.getProperty(BOOT_PATH_PROPERTY) != null) {
			return;
		}
		try {
			final Path target = folder.toPath().resolve(fileName);
			if (!Files.isRegularFile(target)) {
				Files.createDirectories(folder.toPath());
				final Path temp = Files.createTempFile(folder.toPath(), fileName, ".tmp"); //$NON-NLS-1$
				try (InputStream in = library.call()) {
					if (in == null) {
						throw new IOException("JNA has no " + fileName + " for this platform"); //$NON-NLS-1$ //$NON-NLS-2$
					}
					Files.copy(in, temp, StandardCopyOption.REPLACE_EXISTING);
					// Into place whole, so a half-written library is never loaded
					try {
						Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
					} catch (IOException e) {
						// Another Collect Earth starting at the same time put it there first (and may hold it open)
						if (!Files.isRegularFile(target)) {
							throw e;
						}
					}
				} finally {
					Files.deleteIfExists(temp);
				}
			}
			System.setProperty(BOOT_PATH_PROPERTY, folder.getAbsolutePath());
		} catch (Exception e) {
			logger.warn("JNA's library could not be copied to {}, JNA unpacks it at each start: {}", folder, e.toString()); //$NON-NLS-1$
		}
	}
}

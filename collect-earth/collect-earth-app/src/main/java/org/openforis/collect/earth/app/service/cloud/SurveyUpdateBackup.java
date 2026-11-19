package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.stream.Stream;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.FileHeader;

/**
 * The files of a cloud project that opening it again replaces (a changed survey taken, "Update now"), kept until its
 * survey has been loaded at the next start (EarthSurveyService): a survey Collect cannot import would otherwise leave
 * Collect Earth unable to start, the one before overwritten. Kept beside the project folder
 * ({@code projects/.<folder>.before-update}), not in it, whose checksum is the project file's.
 * <p>
 * Only the files of the project file that were there are copied (not the plot files, the assignments, the records);
 * those it adds are listed, so that putting the files back takes them away.
 */
public final class SurveyUpdateBackup {

	static final String MANIFEST = "before-update.properties"; //$NON-NLS-1$
	static final String FILES = "files"; //$NON-NLS-1$
	private static final String ADDED = "added"; //$NON-NLS-1$
	private static final String REVISION_BEFORE = "revisionBefore"; //$NON-NLS-1$
	private static final String REVISION_AFTER = "revisionAfter"; //$NON-NLS-1$

	private static final Logger LOGGER = LoggerFactory.getLogger(SurveyUpdateBackup.class);

	/** What a backup put back says */
	public static final class Restored {
		/** The revision of the survey put back, and of the one that could not be used; null when not known */
		public final String revisionBefore;
		public final String revisionAfter;

		Restored(String revisionBefore, String revisionAfter) {
			this.revisionBefore = revisionBefore;
			this.revisionAfter = revisionAfter;
		}
	}

	private SurveyUpdateBackup() {
	}

	/** Where a project folder's backup is */
	public static File folderOf(File projectFolder) {
		File folder = projectFolder.getAbsoluteFile();
		return new File(folder.getParentFile(), "." + folder.getName() + ".before-update"); //$NON-NLS-1$ //$NON-NLS-2$
	}

	/** Whether a project folder has a backup waiting: the files were replaced, and their survey not loaded yet */
	public static boolean isPending(File projectFolder) {
		return projectFolder != null && new File(folderOf(projectFolder), MANIFEST).isFile();
	}

	/**
	 * Keeps the files of the project folder that the project file is about to replace, before it is unzipped over them.
	 * Nothing is kept for a folder that is not there yet (the first download): there is nothing to go back to.
	 */
	public static void keep(File projectFile, File projectFolder) throws IOException {
		if (projectFolder == null) {
			return;
		}
		File backup = folderOf(projectFolder);
		if (backup.exists()) {
			FileUtils.deleteDirectory(backup);
		}
		if (!projectFolder.isDirectory()) {
			return;
		}
		File folder = projectFolder.getCanonicalFile();
		File files = new File(backup, FILES);
		List<String> added = new ArrayList<>();
		String surveyEntry;
		try (ZipFile zip = new ZipFile(projectFile)) {
			for (FileHeader header : zip.getFileHeaders()) {
				if (header.isDirectory()) {
					continue;
				}
				String name = header.getFileName().replace('\\', '/');
				File target = new File(folder, name).getCanonicalFile();
				if (!target.toPath().startsWith(folder.toPath())) {
					continue; // not unzipped there either
				}
				if (target.isFile()) {
					File copy = new File(files, name);
					Files.createDirectories(copy.getParentFile().toPath());
					Files.copy(target.toPath(), copy.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
				} else {
					added.add(name);
				}
			}
			surveyEntry = SurveyRevision.surveyEntry(zip);
		}
		Properties manifest = new Properties();
		manifest.setProperty(ADDED, String.join("\n", added)); //$NON-NLS-1$
		String before = surveyEntry == null ? null : SurveyRevision.ofFile(new File(folder, surveyEntry));
		String after = SurveyRevision.ofProjectFile(projectFile);
		if (before != null) {
			manifest.setProperty(REVISION_BEFORE, before);
		}
		if (after != null) {
			manifest.setProperty(REVISION_AFTER, after);
		}
		Files.createDirectories(backup.toPath());
		// Written last: a backup without it is not taken for a complete one
		try (OutputStream out = new FileOutputStream(new File(backup, MANIFEST))) {
			manifest.store(out, "The files of " + folder.getName() + " before the project was opened again"); //$NON-NLS-1$ //$NON-NLS-2$
		}
	}

	/**
	 * Puts the files kept back in the project folder, takes away those the project file added, and deletes the backup.
	 * Null when there is no backup.
	 */
	public static Restored restore(File projectFolder) throws IOException {
		if (projectFolder == null) {
			return null;
		}
		File backup = folderOf(projectFolder);
		File manifestFile = new File(backup, MANIFEST);
		if (!manifestFile.isFile()) {
			return null;
		}
		Properties manifest = new Properties();
		try (InputStream in = new FileInputStream(manifestFile)) {
			manifest.load(in);
		}
		File folder = projectFolder.getCanonicalFile();
		for (String name : StringUtils.split(manifest.getProperty(ADDED, ""), '\n')) { //$NON-NLS-1$
			File added = new File(folder, name).getCanonicalFile();
			if (added.toPath().startsWith(folder.toPath()) && !added.equals(folder)) {
				Files.deleteIfExists(added.toPath());
			}
		}
		Path files = new File(backup, FILES).toPath();
		if (Files.isDirectory(files)) {
			try (Stream<Path> kept = Files.walk(files)) {
				for (Path copy : (Iterable<Path>) kept.filter(Files::isRegularFile)::iterator) {
					Path target = folder.toPath().resolve(files.relativize(copy).toString());
					Files.createDirectories(target.getParent());
					Files.copy(copy, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
				}
			}
		}
		Restored restored = new Restored(manifest.getProperty(REVISION_BEFORE), manifest.getProperty(REVISION_AFTER));
		discard(projectFolder);
		return restored;
	}

	/** Deletes a project folder's backup: its survey was loaded */
	public static void discard(File projectFolder) {
		if (projectFolder == null) {
			return;
		}
		File backup = folderOf(projectFolder);
		try {
			// First: a backup left half deleted is not taken for one waiting
			Files.deleteIfExists(new File(backup, MANIFEST).toPath());
			if (backup.exists()) {
				FileUtils.deleteDirectory(backup);
			}
		} catch (IOException e) {
			LOGGER.warn("The files kept before the update of {} could not be deleted: {}", projectFolder, e.getMessage()); //$NON-NLS-1$
		}
	}
}

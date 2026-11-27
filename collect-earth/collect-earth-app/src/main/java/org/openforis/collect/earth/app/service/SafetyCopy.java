package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A copy of what a person cannot get back if a step goes wrong, taken just before that step: the local database
 * (collectEarthDatabase.db), earth.properties and, when given, a project's folder, zipped into the data folder's
 * {@value #FOLDER} folder. Unlike the automatic backups (BackupSqlLiteService, the ten newest kept, one at every quit,
 * and Collect Earth 2 quits and starts again often), nothing ever deletes these.
 * <ul>
 * <li>At the first start of Collect Earth 2 ({@link #beforeFirstStart}), before the database of Collect Earth 1 is
 * opened, so the data as Collect Earth 1 left it is kept.</li>
 * <li>Before joining a cloud project unzips its project file over a project of this computer that is in no cloud
 * project (CloudService): the folder of the project, and the database whose survey the cloud project's then
 * replaces.</li>
 * </ul>
 * The next start tells the person where it is ({@link #pendingNotice}).
 */
public final class SafetyCopy {

	public static final String FOLDER = "safetyCopies"; //$NON-NLS-1$

	/** What a pending notice says: the copy at the first start, or the one before a join */
	public static final String FIRST_START = "firstStart"; //$NON-NLS-1$
	public static final String BEFORE_JOIN = "beforeJoin"; //$NON-NLS-1$

	private static final String NOTHING = "-"; //$NON-NLS-1$
	/** Between the parts of a pending notice: a line break, which no path or project name has */
	private static final String SEPARATOR = "\n"; //$NON-NLS-1$

	private static final Logger LOGGER = LoggerFactory.getLogger(SafetyCopy.class);

	private SafetyCopy() {
	}

	/** Where the copies are: the data folder's safetyCopies */
	public static File folder() {
		return new File(FolderFinder.getCollectEarthDataFolder(), FOLDER);
	}

	/**
	 * Zips the database file, earth.properties and the project folder (each when there is one) into {@code into}, under
	 * a name made of {@code reason} and the time. Written to a ".part" file first and renamed when complete, so a copy
	 * that is there is whole.
	 *
	 * @return the copy, or null when there was nothing to copy
	 */
	static File make(File into, String reason, File database, File properties, File projectFolder) throws IOException {
		boolean hasDatabase = database != null && database.isFile() && database.length() > 0;
		boolean hasProject = projectFolder != null && projectFolder.isDirectory();
		if (!hasDatabase && !hasProject) {
			return null;
		}
		Files.createDirectories(into.toPath());
		String name = safeName(reason) + "_" + new SimpleDateFormat("yyyy-MM-dd_HHmmss").format(new Date()); //$NON-NLS-1$ //$NON-NLS-2$
		File target = unique(into, name);
		File part = new File(into, target.getName() + ".part"); //$NON-NLS-1$
		try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(part.toPath()))) {
			if (hasDatabase) {
				add(zip, database.toPath(), database.getName());
			}
			if (properties != null && properties.isFile()) {
				add(zip, properties.toPath(), properties.getName());
			}
			if (hasProject) {
				Path root = projectFolder.toPath();
				String base = "projects/" + projectFolder.getName() + "/"; //$NON-NLS-1$ //$NON-NLS-2$
				try (Stream<Path> files = Files.walk(root)) {
					for (Path file : (Iterable<Path>) files.filter(Files::isRegularFile)::iterator) {
						add(zip, file, base + root.relativize(file).toString().replace(File.separatorChar, '/'));
					}
				}
			}
		} catch (IOException | RuntimeException e) {
			Files.deleteIfExists(part.toPath());
			throw e;
		}
		Files.move(part.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE);
		LOGGER.info("Safety copy taken ({}): {}", reason, target.getAbsolutePath()); //$NON-NLS-1$
		return target;
	}

	/** {@link #make} of this computer's database and earth.properties, into the data folder's safetyCopies */
	public static File make(String reason, File projectFolder) throws IOException {
		return make(folder(), reason, new File(EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB),
				new File(FolderFinder.getCollectEarthDataFolder(), "earth.properties"), projectFolder); //$NON-NLS-1$
	}

	/** The first start's copy, taken before the settings are read: its name, NOTHING, or null when none was taken */
	private static String firstStartCopy;

	/**
	 * Once, at the first start of Collect Earth 2, before the settings are read (reading them adds keys and applies the
	 * installation's forced values) and before the database is opened: a copy of the database and the settings of
	 * Collect Earth 1 as they were. Whether it was taken already is read from the settings file itself. Later starts
	 * (and a new installation, which has no database yet) take none. A copy that fails is logged and the start goes on
	 * (the automatic backups are still there); it is tried again at the next start. {@link #rememberFirstStart} then
	 * keeps, in the settings, that it was taken.
	 */
	public static void beforeFirstStart() {
		File settings = new File(FolderFinder.getCollectEarthDataFolder(), "earth.properties"); //$NON-NLS-1$
		if (StringUtils.isNotBlank(rawSetting(settings, EarthProperty.SAFETY_COPY_FIRST_START.toString()))) {
			return;
		}
		try {
			File copy = make("before-collect-earth-2", null); //$NON-NLS-1$
			firstStartCopy = copy == null ? NOTHING : copy.getAbsolutePath();
		} catch (IOException | RuntimeException e) {
			LOGGER.error("The safety copy of the database before the first start of Collect Earth 2 could not be taken", e); //$NON-NLS-1$
		}
	}

	/** After {@link #beforeFirstStart}, the settings read: that the copy was taken, and to tell the person where it is */
	public static void rememberFirstStart(LocalPropertiesService properties) {
		String copy = firstStartCopy;
		firstStartCopy = null;
		if (copy == null) {
			return;
		}
		properties.setValue(EarthProperty.SAFETY_COPY_FIRST_START, NOTHING.equals(copy) ? NOTHING : new File(copy).getName());
		if (!NOTHING.equals(copy)) {
			properties.setValue(EarthProperty.SAFETY_COPY_NOTICE, FIRST_START + SEPARATOR + copy);
		}
	}

	/** A value of a settings file as it is on disk, or null (no file, not readable) */
	static String rawSetting(File settings, String key) {
		if (!settings.isFile()) {
			return null;
		}
		java.util.Properties read = new java.util.Properties();
		try (java.io.InputStream in = Files.newInputStream(settings.toPath())) {
			read.load(in);
			return read.getProperty(key);
		} catch (IOException | IllegalArgumentException e) {
			return null;
		}
	}

	/** Remembers a copy to tell the person about at the next start: {@link #BEFORE_JOIN} with the project's name */
	public static void tellAtNextStart(LocalPropertiesService properties, String kind, File copy, String projectName) {
		properties.setValue(EarthProperty.SAFETY_COPY_NOTICE,
				kind + SEPARATOR + copy.getAbsolutePath() + SEPARATOR + StringUtils.defaultString(projectName));
	}

	/**
	 * The copy to tell the person about, taken from the settings so that it is told once: {kind, path, project name}
	 * (the name empty for the first start), or null.
	 */
	public static String[] pendingNotice(LocalPropertiesService properties) {
		String pending = StringUtils.trimToNull(properties.getValue(EarthProperty.SAFETY_COPY_NOTICE));
		if (pending == null) {
			return null;
		}
		properties.setValue(EarthProperty.SAFETY_COPY_NOTICE, ""); //$NON-NLS-1$
		String[] parts = StringUtils.splitPreserveAllTokens(pending, SEPARATOR, 3);
		if (parts.length < 2) {
			return null;
		}
		return new String[] { parts[0], parts[1], parts.length > 2 ? parts[2] : "" }; //$NON-NLS-1$
	}

	private static void add(ZipOutputStream zip, Path file, String entry) throws IOException {
		zip.putNextEntry(new ZipEntry(entry));
		Files.copy(file, (OutputStream) zip);
		zip.closeEntry();
	}

	/** Letters, digits, - and _ only (a project's name is in it) */
	static String safeName(String reason) {
		String safe = StringUtils.defaultString(reason).replaceAll("[^A-Za-z0-9_-]+", "-").replaceAll("-{2,}", "-"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		safe = StringUtils.strip(safe, "-"); //$NON-NLS-1$
		return safe.isEmpty() ? "copy" : StringUtils.left(safe, 80); //$NON-NLS-1$
	}

	private static File unique(File into, String name) {
		File file = new File(into, name + ".zip"); //$NON-NLS-1$
		for (int n = 2; file.exists(); n++) {
			file = new File(into, name + "-" + n + ".zip"); //$NON-NLS-1$ //$NON-NLS-2$
		}
		return file;
	}
}

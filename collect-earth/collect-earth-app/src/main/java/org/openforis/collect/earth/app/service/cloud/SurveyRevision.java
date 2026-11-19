package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Properties;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.io.IOUtils;
import org.slf4j.LoggerFactory;

import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.FileHeader;

/**
 * A survey's revision, as the cloud server names it (collect-earth-cloud, src/routes/surveyDesign.ts {@code revisionOf}):
 * the first 24 hexadecimal digits of the SHA-256 of the bytes of the survey file (placemark.idm.xml) of the project file.
 * Collect Earth unzips that file byte for byte and never writes it again, so the revision of the file in the project
 * folder is the one of the project file it came from.
 */
public final class SurveyRevision {

	static final String PROJECT_PROPERTIES = "project_definition.properties"; //$NON-NLS-1$
	/** The key of the survey file in the project's properties, and its usual name (the server's LOCATIONS.survey) */
	static final String SURVEY_KEY = "metadata_file"; //$NON-NLS-1$
	static final String SURVEY_FALLBACK = "placemark.idm.xml"; //$NON-NLS-1$
	private static final String PROJECT_PATH = "${project_path}"; //$NON-NLS-1$
	private static final int LENGTH = 24;

	private SurveyRevision() {
	}

	/** The revision of a survey's bytes */
	public static String of(byte[] survey) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256").digest(survey); //$NON-NLS-1$
			StringBuilder hex = new StringBuilder(digest.length * 2);
			for (byte b : digest) {
				hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
			}
			return hex.substring(0, LENGTH);
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}

	/** The revision of a survey file (the project's placemark.idm.xml), or null when it cannot be read */
	public static String ofFile(File survey) {
		if (survey == null || !survey.isFile()) {
			return null;
		}
		try {
			return of(Files.readAllBytes(survey.toPath()));
		} catch (IOException e) {
			LoggerFactory.getLogger(SurveyRevision.class).warn("The survey {} could not be read: {}", survey, e.getMessage()); //$NON-NLS-1$
			return null;
		}
	}

	/**
	 * The revision of the survey inside a project file (.cep), found as the server finds it: the entry its properties
	 * name ({@code metadata_file}, without its {@code ${project_path}/}), else placemark.idm.xml. Null when it has none or
	 * cannot be read.
	 */
	public static String ofProjectFile(File projectFile) {
		if (projectFile == null || !projectFile.isFile()) {
			return null;
		}
		try (ZipFile zip = new ZipFile(projectFile)) {
			String entry = surveyEntry(zip);
			if (entry == null) {
				return null;
			}
			try (InputStream in = zip.getInputStream(zip.getFileHeader(entry))) {
				return of(IOUtils.toByteArray(in));
			}
		} catch (IOException | RuntimeException e) {
			LoggerFactory.getLogger(SurveyRevision.class).warn("The survey of {} could not be read: {}", projectFile, e.getMessage()); //$NON-NLS-1$
			return null;
		}
	}

	/**
	 * The revision of the survey a project folder has where a project file would put its own (the same entry, unzipped
	 * there), or null when the folder has none or a file cannot be read: the survey a project file replaces.
	 */
	public static String ofFolderFor(File projectFile, File projectFolder) {
		if (projectFile == null || projectFolder == null || !projectFile.isFile()) {
			return null;
		}
		try (ZipFile zip = new ZipFile(projectFile)) {
			String entry = surveyEntry(zip);
			return entry == null ? null : ofFile(new File(projectFolder, entry));
		} catch (IOException | RuntimeException e) {
			LoggerFactory.getLogger(SurveyRevision.class).warn("The survey of {} could not be read: {}", projectFile, e.getMessage()); //$NON-NLS-1$
			return null;
		}
	}

	/** The name of the survey's entry in a project file, as {@link #ofProjectFile} finds it, or null when it has none */
	static String surveyEntry(ZipFile zip) throws IOException {
		FileHeader survey = null;
		FileHeader settings = zip.getFileHeader(PROJECT_PROPERTIES);
		if (settings != null) {
			Properties properties = new Properties();
			try (InputStream in = zip.getInputStream(settings)) {
				properties.load(new InputStreamReader(in, StandardCharsets.UTF_8));
			}
			String named = entryNamed(properties.getProperty(SURVEY_KEY));
			if (named != null) {
				survey = zip.getFileHeader(named);
			}
		}
		if (survey == null) {
			survey = zip.getFileHeader(SURVEY_FALLBACK);
		}
		return survey == null || survey.isDirectory() ? null : survey.getFileName();
	}

	/** The zip entry a {@code metadata_file} value names: {@code ${project_path}/placemark.idm.xml} is placemark.idm.xml */
	static String entryNamed(String value) {
		String path = StringUtils.trimToNull(value);
		if (path == null) {
			return null;
		}
		if (path.startsWith(PROJECT_PATH)) {
			path = path.substring(PROJECT_PATH.length());
			// Java's properties take a single backslash for an escape: ${project_path}\x is read as ${project_path}x
			if (path.startsWith("/") || path.startsWith("\\")) { //$NON-NLS-1$ //$NON-NLS-2$
				path = path.substring(1);
			}
		}
		return StringUtils.trimToNull(path);
	}
}

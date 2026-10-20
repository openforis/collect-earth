package org.openforis.collect.earth.sampler.processor;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class KmzGenerator {

	private final Logger logger = LoggerFactory.getLogger(KmzGenerator.class);

	private void addFileToZip(String path, String srcFile, ZipOutputStream zip) throws IOException {

		final File file = new File(srcFile);
		if (file.isDirectory()) {
			addFolderToZip(path, srcFile, zip);
		} else {
			String filePathName = path + "/" + file.getName();
			// if in root folder no / necessary
			if (path.length() == 0) {
				filePathName = file.getName();
			}
			zip.putNextEntry(new ZipEntry(filePathName));
			try {
				// A failure used to be logged here and the truncated entry kept, so the KMZ looked complete
				Files.copy(file.toPath(), zip);
			} finally {
				zip.closeEntry();
			}
		}
	}

	private void addFolderToZip(String path, String srcFolder, ZipOutputStream zip) throws IOException {
		final File folder = new File(srcFolder);

		final String[] fileNames = folder.list();
		if (fileNames == null) {
			throw new IOException("Cannot list the contents of the folder " + srcFolder);
		}

		for (final String fileName : fileNames) {
			if (path.equals("")) {
				addFileToZip(folder.getName(), srcFolder + "/" + fileName, zip);
			} else {
				addFileToZip(path + "/" + folder.getName(), srcFolder + "/" + fileName, zip);
			}
		}
	}

	public void generateKmzFile(String kmzFilename, String kmlFile, String dependantFolder) throws IOException {


		try (
				FileOutputStream fileWriter = new FileOutputStream(kmzFilename);
				ZipOutputStream zip = new ZipOutputStream(fileWriter);

		){
			// Add the KML to the root folder
			addFileToZip("", kmlFile, zip);

			// Add the Images/JS etc to the file folder
			if (dependantFolder != null) {
				addFolderToZip("", dependantFolder, zip);
			}
		} catch (final IOException e) {
			// Do not leave a partial KMZ behind that Google Earth would open as if it were complete
			Files.deleteIfExists(Paths.get(kmzFilename));
			throw e;
		}
	}
}

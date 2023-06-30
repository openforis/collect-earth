package org.openforis.collect.earth.app;

import java.awt.Desktop;
import java.awt.Font;
import java.awt.FontFormatException;
import java.awt.GraphicsEnvironment;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.Enumeration;
import java.util.List;
import java.util.Properties;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import javax.swing.UIManager;

import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.view.Messages;
import org.postgresql.Driver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.exception.ZipException;
import net.lingala.zip4j.model.ZipParameters;
import net.lingala.zip4j.model.enums.CompressionLevel;
import net.lingala.zip4j.model.enums.CompressionMethod;

public class CollectEarthUtils {

	private static final Logger logger = LoggerFactory.getLogger(CollectEarthUtils.class);

	private CollectEarthUtils() {
	}

	public static String getMd5FromFolder(File folder) throws IOException {

		if (!folder.isDirectory()) {
			throw new IllegalArgumentException("The file passed as an argument needs to be a folder!");
		}
		StringBuilder md5Hex = new StringBuilder();

		try( Stream<Path> paths = Files.walk(Paths.get(folder.toURI()), 3); ) {
			List<File> listFiles = paths.filter(Files::isRegularFile).map(Path::toFile)
					.collect(Collectors.toList());
			for (File file : listFiles) {
				md5Hex.append(DigestUtils.md5Hex(new FileInputStream(file)));
			}
			return DigestUtils.md5Hex(md5Hex.toString().getBytes());
		}
	}

	public static String getMd5FromFile(String filePath) throws IOException {
		return DigestUtils.md5Hex(new FileInputStream(new File(filePath)));
	}

	public static void setFontDependingOnLanguaue(UI_LANGUAGE uiLanguage) {
		if (uiLanguage == UI_LANGUAGE.LO) {
			String ttfFileName = "Phetsarath_OT.ttf";
			// create the font
			setUiFont(ttfFileName);
		} else if (uiLanguage == UI_LANGUAGE.MN) {
			String ttfFileName = "arhangai.ttf";
			// create the font
			setUiFont(ttfFileName);
		} else {
			CollectEarthUtils.setUiFont(new javax.swing.plaf.FontUIResource("Arial Unicode MS", Font.PLAIN, 12));
		}
	}

	public static void setUiFont(String ttfFileName) {
		try {
			// create the font to use. Specify the size!
			InputStream fontStream = CollectEarthUtils.class.getResourceAsStream(ttfFileName);
			Font laoFont = Font.createFont(Font.TRUETYPE_FONT, fontStream).deriveFont(12f);
			GraphicsEnvironment ge = GraphicsEnvironment.getLocalGraphicsEnvironment();
			// register the font
			ge.registerFont(laoFont);
			CollectEarthUtils.setUiFont(new javax.swing.plaf.FontUIResource(laoFont.getFontName(), Font.PLAIN, 12));
		} catch (IOException | FontFormatException e) {
			logger.error("error setting the font " + ttfFileName, e);
		}

	}

	private static void setUiFont(javax.swing.plaf.FontUIResource f) {
		Enumeration<Object> keys = UIManager.getDefaults().keys();
		while (keys.hasMoreElements()) {
			Object key = keys.nextElement();
			Object value = UIManager.get(key);
			if (value instanceof javax.swing.plaf.FontUIResource)
				UIManager.put(key, f);
		}
	}

	public static ZipFile addFileToZip(String pathToDestinationZip, File fileToAdd, String fileNameInZip) throws IOException {
		File destinationZip = new File(pathToDestinationZip);
		return addFileToZip(destinationZip, fileToAdd, fileNameInZip);
	}
	
	public static ZipFile addFileToZip(File destinationZip, File fileToAdd, String fileNameInZip) throws IOException {
		try( ZipFile zipFile = new ZipFile(destinationZip) ){
			ZipParameters zipParameters = new ZipParameters();
			// COMP_DEFLATE is for compression
			zipParameters.setCompressionMethod(CompressionMethod.DEFLATE);
			// DEFLATE_LEVEL_ULTRA = maximum compression
			zipParameters.setCompressionLevel(CompressionLevel.ULTRA);
			zipParameters.setFileNameInZip(fileNameInZip);
			zipFile.addFile(fileToAdd, zipParameters);
			return zipFile;
		}catch(Exception e) {
			logger.error("Error adding file to ZIP", e);
			return null;
		}
	}

	public static String getComputerIp() {
		try {
			return InetAddress.getLocalHost().getHostAddress();
		} catch (final UnknownHostException e) {
			logger.warn("Unknown IP address", e); //$NON-NLS-1$
			return Messages.getString("OptionWizard.11"); //$NON-NLS-1$
		}
	}

	public static void addFolderToZip(ZipFile zipFile, File folderToCompress) throws ZipException {
		ZipParameters zipParameters = new ZipParameters();
		// COMP_DEFLATE is for compression
		zipParameters.setCompressionMethod(CompressionMethod.DEFLATE);
		// DEFLATE_LEVEL_ULTRA = maximum compression
		zipParameters.setCompressionLevel(CompressionLevel.ULTRA);

		if (folderToCompress.exists() && folderToCompress.isDirectory()) {
			zipFile.addFolder(folderToCompress, zipParameters);
		}
	}

	public static void openFolderInExplorer(String folder) throws IOException {
		if (Desktop.isDesktopSupported()) {
			Desktop.getDesktop().open(new File(folder));
		} else {
			if (SystemUtils.IS_OS_WINDOWS) {
				new ProcessBuilder("explorer.exe", "/open," + folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
			} else if (SystemUtils.IS_OS_MAC) {
				new ProcessBuilder("usr/bin/open", folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
			} else if (SystemUtils.IS_OS_UNIX) {
				tryUnixFileExplorers(folder);
			}
		}
	}

	public static void tryUnixFileExplorers(String folder) throws IOException {
		try {
			new ProcessBuilder("nautilus", folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
		} catch (IOException e1) {
			try {
				new ProcessBuilder("gnome-open", folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
			} catch (IOException e2) {
				try {
					new ProcessBuilder("kde-open", folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
				} catch (IOException e3) {
					new ProcessBuilder("caja", folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
				}
			}
		}
	}

	public static boolean openFile(File fileToOpenWithOSViewer) {
		boolean success = false;
		if (Desktop.isDesktopSupported()) {
			try {
				Desktop.getDesktop().open(fileToOpenWithOSViewer);
				success = true;
			} catch (IOException ex) {
				logger.warn("No application registered to open file {}", fileToOpenWithOSViewer.getAbsolutePath()); //$NON-NLS-1$
			}
		}
		return success;
	}

	public static String testPostgreSQLConnection(String host, String port, String dbName, String username,
			String password) {
		String message = "Connection OK!";
		try {
			Driver postgresDriver = new Driver();
			DriverManager.registerDriver(postgresDriver, null);
			String url = "jdbc:postgresql://" + host + ":" + port + "/" + dbName;
			try( Connection conn = DriverManager.getConnection(url, username, password) ){
				logger.debug("PostgreSQL Connection is valid! {}", conn.isValid(10) );// 10 sec
			}
		} catch (Exception e) {
			logger.error("Error connecting to DB while testing", e);
			message = e.getMessage();
		}
		return message;
	}

}

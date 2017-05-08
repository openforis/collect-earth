package org.openforis.collect.earth.app;

import java.awt.Desktop;
import java.awt.Font;
import java.awt.FontFormatException;
import java.awt.GraphicsEnvironment;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Enumeration;
import java.util.List;
import java.util.stream.Collectors;

import javax.swing.UIManager;

import net.lingala.zip4j.core.ZipFile;
import net.lingala.zip4j.exception.ZipException;
import net.lingala.zip4j.model.ZipParameters;
import net.lingala.zip4j.util.Zip4jConstants;

import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.postgresql.Driver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class CollectEarthUtils {

	private static final Logger logger = LoggerFactory.getLogger( CollectEarthUtils.class);

	private CollectEarthUtils(){
	}

	public static String getMd5FromFolder(File folder) throws IOException {

		if( !folder.isDirectory() ){
			throw new IllegalArgumentException("The file passed as an argument needs to be a folder!");
		}
		StringBuilder md5Hex = new StringBuilder();

		List<File> listFiles = Files.walk( Paths.get( folder.toURI()) , 3 ).filter(Files::isRegularFile).map(Path::toFile).collect(Collectors.toList());
		for (File file : listFiles) {
			md5Hex.append( DigestUtils.md5Hex(new FileInputStream(file)) );
		}
		return DigestUtils.md5Hex( md5Hex.toString().getBytes());
	}

	public static String getMd5FromFile(String filePath) throws IOException {
		return DigestUtils.md5Hex(new FileInputStream(new File(filePath)));
	}


	public static void setFontDependingOnLanguaue( UI_LANGUAGE ui_language){
		if( ui_language == UI_LANGUAGE.LO){
			String ttfFileName = "Phetsarath_OT.ttf";
			//create the font
			setUiFont(ttfFileName);
		}else if( ui_language == UI_LANGUAGE.MN){
			String ttfFileName = "arhangai.ttf";
			//create the font
			setUiFont(ttfFileName);
		}else{
			CollectEarthUtils.setUIFont( new javax.swing.plaf.FontUIResource("Arial Unicode MS",Font.PLAIN,12) );
		}
	}


	public static void setUiFont(String ttfFileName) {
		try {
			//create the font to use. Specify the size!
			InputStream fontStream = CollectEarthUtils.class.getResourceAsStream(ttfFileName);
			Font laoFont = Font.createFont(Font.TRUETYPE_FONT, fontStream).deriveFont(12f);
			GraphicsEnvironment ge = GraphicsEnvironment.getLocalGraphicsEnvironment();
			//register the font
			ge.registerFont(laoFont);
			CollectEarthUtils.setUIFont( new javax.swing.plaf.FontUIResource( laoFont.getFontName(),Font.PLAIN,12)  );
		} catch (IOException | FontFormatException e) {
			logger.error("error setting the font " + ttfFileName , e );
		}
	}

	private static void setUIFont (javax.swing.plaf.FontUIResource f){
		Enumeration<Object> keys = UIManager.getDefaults().keys();
		while (keys.hasMoreElements()) {
			Object key = keys.nextElement();
			Object value = UIManager.get (key);
			if (value != null && value instanceof javax.swing.plaf.FontUIResource)
				UIManager.put (key, f);
		}
	} 

	public static ZipFile addFileToZip(String fileToCompress, File srcFile, String fileNameInZip )
			throws ZipException {
		File destBackupFile = new File( fileToCompress );	
		ZipFile zipBackupFile = new ZipFile( destBackupFile );

		ZipParameters zipParameters = new ZipParameters();
		// COMP_DEFLATE is for compression
		zipParameters.setCompressionMethod(Zip4jConstants.COMP_DEFLATE);
		// DEFLATE_LEVEL_ULTRA = maximum compression
		zipParameters.setCompressionLevel(Zip4jConstants.DEFLATE_LEVEL_ULTRA);
		zipParameters.setSourceExternalStream(true);
		zipParameters.setFileNameInZip( fileNameInZip );				
		zipBackupFile.addFile(srcFile, zipParameters);

		return zipBackupFile;
	}

	public static String getComputerIp() {
		try {
			return InetAddress.getLocalHost().getHostAddress();
		} catch (final UnknownHostException e) {
			logger.warn("Unknown IP address", e); //$NON-NLS-1$
			return Messages.getString("OptionWizard.11"); //$NON-NLS-1$
		}
	}

	public static void addFolderToZip(ZipFile zipFile, File folderToCompress )
			throws ZipException {
		ZipParameters zipParameters = new ZipParameters();
		// COMP_DEFLATE is for compression
		zipParameters.setCompressionMethod(Zip4jConstants.COMP_DEFLATE);
		// DEFLATE_LEVEL_ULTRA = maximum compression
		zipParameters.setCompressionLevel(Zip4jConstants.DEFLATE_LEVEL_ULTRA);

		if( folderToCompress.exists() && folderToCompress.isDirectory() ){
			zipFile.addFolder(folderToCompress, zipParameters);
		}
	}

	public static void openFolderInExplorer(String folder) throws IOException {
		if (Desktop.isDesktopSupported()) {
			Desktop.getDesktop().open(new File(folder));
		}else{
			if (SystemUtils.IS_OS_WINDOWS){
				new ProcessBuilder("explorer.exe", "/open," + folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
			}else if (SystemUtils.IS_OS_MAC){
				new ProcessBuilder("usr/bin/open", folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
			}else if ( SystemUtils.IS_OS_UNIX){
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

	

	public static String testPostgreSQLConnection(String host, String port, String dbName,
			String username, String password) {
		Connection conn = null;  
		String message ="Connection OK!";
		try {    
			Class.forName("org.postgresql.Driver");				
			Driver postgresDriver = new Driver();
			DriverManager.registerDriver(postgresDriver, null);
			String url = "jdbc:postgresql://"+host+":"+port+"/"+dbName;
			conn = DriverManager.getConnection(url, username, password);

			boolean reachable = conn.isValid(10);// 10 sec
		} catch(ClassNotFoundException e){
			logger.error( "No PostgreSQL driver found", e );   
		} catch (Exception e) {    
			logger.error( "Error connecting to DB while testing", e );   
			message = e.getMessage();
		}
		finally {    
			if (conn != null) {    
				try {    
					conn.close();    
				} catch (SQLException e) {    
					// ignore    
					logger.error("Error connecting to DB", e);
				}    
			}    
		}
		return message;

	}

	public static boolean validateCsvColumns(File fileToImport) throws KmlGenerationException{
		// TODO Auto-generated method stub
		return true;
	}

}

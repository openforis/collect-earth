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
import java.util.Enumeration;

import javax.swing.UIManager;

import net.lingala.zip4j.core.ZipFile;
import net.lingala.zip4j.exception.ZipException;
import net.lingala.zip4j.model.ZipParameters;
import net.lingala.zip4j.util.Zip4jConstants;

import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class CollectEarthUtils {

	public static String getMd5FromFile(File file) throws IOException {
		return DigestUtils.md5Hex(new FileInputStream(file));
	}
	public static String getMd5FromFile(String filePath) throws IOException {
		return DigestUtils.md5Hex(new FileInputStream(new File(filePath)));
	}

	
	public static void setFontDependingOnLanguaue( UI_LANGUAGE ui_language){
		if( ui_language == UI_LANGUAGE.LO){
			String ttfFileName = "Phetsarath_OT.ttf";
            //create the font
            setUiFont(ttfFileName);
		}/*else if( ui_language == UI_LANGUAGE.MN){
			String ttfFileName = "arhangai.ttf";
            //create the font
            setUiFont(ttfFileName);
		}*/else{
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
		    Logger logger = LoggerFactory.getLogger( CollectEarthUtils.class);
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
			LoggerFactory.getLogger(CollectEarthUtils.class).warn("Unknown IP address", e); //$NON-NLS-1$
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
	
				try {
					new ProcessBuilder("nautilus", folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
				} catch (Exception e1) {
					try {
						new ProcessBuilder("gnome-open", folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
					} catch (Exception e2) {
						try {
							new ProcessBuilder("kde-open", folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
						} catch (Exception e3) {
							new ProcessBuilder("caja", folder).start(); //$NON-NLS-1$ //$NON-NLS-2$
						}
					}
				}
			}
		}
	}

}

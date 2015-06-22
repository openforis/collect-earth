package org.openforis.collect.earth.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Enumeration;

import javax.swing.UIManager;

import net.lingala.zip4j.core.ZipFile;
import net.lingala.zip4j.exception.ZipException;
import net.lingala.zip4j.model.ZipParameters;
import net.lingala.zip4j.util.Zip4jConstants;

import org.apache.commons.codec.digest.DigestUtils;

public class CollectEarthUtils {

	public static String getMd5FromFile(File file) throws IOException {
		return DigestUtils.md5Hex(new FileInputStream(file));
	}
	public static String getMd5FromFile(String filePath) throws IOException {
		return DigestUtils.md5Hex(new FileInputStream(new File(filePath)));
	}
	
	public static void setUIFont (javax.swing.plaf.FontUIResource f){
	    Enumeration<Object> keys = UIManager.getDefaults().keys();
	    while (keys.hasMoreElements()) {
	      Object key = keys.nextElement();
	      Object value = UIManager.get (key);
	      if (value != null && value instanceof javax.swing.plaf.FontUIResource)
	        UIManager.put (key, f);
	      }
	    } 
	
	public static void addFileToZip(String zipFile, File srcFile, String fileNameInZip )
			throws ZipException {
		File destBackupFile = new File( zipFile );	
		ZipFile zipBackupFile = new ZipFile( destBackupFile );
		
		ZipParameters zipParameters = new ZipParameters();
		// COMP_DEFLATE is for compression
		zipParameters.setCompressionMethod(Zip4jConstants.COMP_DEFLATE);
		// DEFLATE_LEVEL_ULTRA = maximum compression
		zipParameters.setCompressionLevel(Zip4jConstants.DEFLATE_LEVEL_ULTRA);
		zipParameters.setSourceExternalStream(true);
		zipParameters.setFileNameInZip( fileNameInZip );				
		zipBackupFile.addFile(srcFile, zipParameters);
	}
}

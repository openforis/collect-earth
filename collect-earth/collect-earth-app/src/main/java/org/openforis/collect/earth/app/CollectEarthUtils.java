package org.openforis.collect.earth.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Enumeration;

import javax.swing.UIManager;

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
}

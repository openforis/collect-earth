package org.openforis.collect.earth.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;

import org.apache.commons.codec.digest.DigestUtils;

public class CollectEarthUtils {

	public static String getMd5FromFile(File file) throws IOException {
		return DigestUtils.md5Hex(new FileInputStream(file));
	}
	public static String getMd5FromFile(String filePath) throws IOException {
		return DigestUtils.md5Hex(new FileInputStream(new File(filePath)));
	}
	
	
}

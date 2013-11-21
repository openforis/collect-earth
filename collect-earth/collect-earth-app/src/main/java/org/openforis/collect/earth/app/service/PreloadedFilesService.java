package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.apache.commons.io.FileUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class PreloadedFilesService {

	private final Logger logger = LoggerFactory.getLogger(PreloadedFilesService.class);

	private final Map<String,byte[]> filesInMemory;
	
	public PreloadedFilesService() {
		filesInMemory = new ConcurrentHashMap<String, byte[]>();
	}
	
	public byte[] getFileContent(File file) {
		byte[] fileContents = filesInMemory.get(file.getPath());
		if (fileContents == null) {
			byte content[] = new byte[0];
			try {
				content = FileUtils.readFileToByteArray(file);
				filesInMemory.put(file.getPath(), content);
			} catch (IOException e) {
				logger.error("Problems while reading the file " + file.getPath() + " was not found.", e);
			}
			fileContents = content;
		}
		return fileContents;
	}
}

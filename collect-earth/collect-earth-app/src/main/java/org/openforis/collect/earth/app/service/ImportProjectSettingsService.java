package org.openforis.collect.earth.app.service;

import java.io.File;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class ImportProjectSettingsService {

	
	@Autowired
	LocalPropertiesService localPropertiesService;
	String destinationFolderPrefix = FolderFinder.getLocalFolder() + File.separator + "surveys" + File.separator + "version_";
	
	public boolean importProjectSettings(File projectSettingFile){
		boolean success = true;
		
		
		File getDestinationFolder = getDestinationFolder();
		
		
		return success;
	}


	private File getDestinationFolder() {
		return new File(destinationFolderPrefix + getNextVersionNumber());
	}


	private int getNextVersionNumber() {
		int versionId = 1;
		while( new File(destinationFolderPrefix + versionId).exists( )){
			versionId++;
		}
		return versionId;
	}
	
}

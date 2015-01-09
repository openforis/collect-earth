package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

import net.lingala.zip4j.core.ZipFile;
import net.lingala.zip4j.exception.ZipException;

import org.apache.commons.lang.ArrayUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;



@Component
public class EarthProjectsService {

	
	private static final int MAX_FOLDER_LENGTH = 20;

	private static final String PROJECT_FILE_NAME = "project_definition.properties"; //$NON-NLS-1$

	private static final String PROJECTS = "projects"; //$NON-NLS-1$
	
	@Autowired
	LocalPropertiesService localPropertiesService;
	
	private Logger logger = LoggerFactory.getLogger( EarthProjectsService.class );
	
	public void init(LocalPropertiesService localPropertiesService) {
		this.localPropertiesService = localPropertiesService;
	}

	public Map<String,File> getProjectList(){
		ArrayList<File> projectFolders = getProjects();
		
		HashMap<String, File> projectListByName = new HashMap<String, File>();
		for (File projectFolder : projectFolders) {
			
			try {
				
				File projectPropertiesFile = getProjectPropertiesFile( projectFolder );
				String projectName = getProjectSurveyName(projectPropertiesFile);
				
				projectListByName.put( projectName , projectFolder);
			} catch (IOException e) {
				logger.error("The project definition file cannot be read.", e); //$NON-NLS-1$
			}
			
		}
		
		return projectListByName;
	}


	private String getProjectSurveyName(File projectPropertiesFile) throws IOException {
		Properties properties;
		properties = getProjectProperties(projectPropertiesFile);
		String projectName = properties.getProperty( EarthProperty.SURVEY_NAME.toString() );
		return projectName;
	}
	
	
	private ArrayList<File> getProjects() {
		String loadedProjects = localPropertiesService.getValue( EarthProperty.LOADED_PROJECTS );
		
		String[] projectFolderPaths = loadedProjects.split( File.pathSeparator );
		
		ArrayList<File> workingProjectFolders = new ArrayList<File>(); 
		
		for (String projectFolder : projectFolderPaths) {
			try {
				
				File projectFolderFile = new File(projectFolder);
				File projectDefinitionFile = getProjectPropertiesFile( projectFolderFile);
				if( validateProjectDefinitionFile( projectDefinitionFile )  ){
					workingProjectFolders.add( projectFolderFile );
				}
				
			} catch (IllegalArgumentException e) {
				logger.error("The project definition file is not complete.", e); //$NON-NLS-1$
			} catch (IOException e) {
				logger.error("The project definition file cannot be read.", e); //$NON-NLS-1$
			}
			
		}
		
		
		return workingProjectFolders;
	}


	private boolean checkValidContent(File definitionFile) throws IOException {
		Properties projectProperties = getProjectProperties( definitionFile );
		
		return projectProperties.containsKey( EarthProperty.SURVEY_NAME.toString() );
		
	}


	/**
	 * Loads the contents of the project-specific properties into earth.properties
	 * 
	 * @param projectFolder The folder where the project definition and the rest of the files reside.
	 * @return True is the project was loaded corretlt
	 * @throws IOException If the projct folder or one of its files cannot be found
	 */
	public boolean loadProjectInFolder(File projectFolder ) throws IOException{
		
		File projectPropertiesFile = getProjectPropertiesFile( projectFolder );
		
		boolean success = false;
		
		// Change the loaded project only if the project definition file has changed or the user changes project
		if( 
				!getProjectDefinitionMD5().equals( CollectEarthUtils.getMd5FromFile( getProjectPropertiesFile(projectFolder)) ) 
					&&
				validateProjectDefinitionFile(projectPropertiesFile) 
		){
		
			Properties projectProperties = getProjectProperties( projectPropertiesFile );
			
			applyPropertiesToCollectEarth( projectProperties, projectFolder );
			
			addToProjectList(projectFolder);
			
			setProjectDefinitionMD5(projectFolder);
			
			success = true;
		}
		

		return success;
	}


	private void setProjectDefinitionMD5(File projectFolder) throws IOException {
		localPropertiesService.setValue( EarthProperty.ACTIVE_PROJECT_DEFINITION, CollectEarthUtils.getMd5FromFile( getProjectPropertiesFile(projectFolder)) );
	}
	
	private String getProjectDefinitionMD5() {
		return localPropertiesService.getValue( EarthProperty.ACTIVE_PROJECT_DEFINITION);
	}
	

	public File getProjectPropertiesFile(File projectFolder) {
		return new File( projectFolder.getAbsolutePath() + File.separator + PROJECT_FILE_NAME );
	}


	private void applyPropertiesToCollectEarth(Properties projectProperties, File projectFolder) {

		for (Object key : projectProperties.keySet()) {
			String value = projectProperties.getProperty((String) key);
			value = value.replace("${project_path}", projectFolder.getAbsolutePath()); //$NON-NLS-1$
			EarthProperty earthPropertyEnum = getEarthPropertyEnum(key);
			if( earthPropertyEnum != null ){
				localPropertiesService.setValue( earthPropertyEnum , value);
			}else{
				logger.warn("The property in the is unknown : " +  key) ; //$NON-NLS-1$
			}
		}
		
	}

	private EarthProperty getEarthPropertyEnum(Object key) {
		EarthProperty[] values = EarthProperty.values();
		for (EarthProperty earthProperty : values) {
			if( earthProperty.toString().equals( key ) ){
				return earthProperty;
			}
		}
		return null;
	}

	private Properties getProjectProperties(File definitionFile) throws IOException {
						
		FileReader fr = new FileReader( definitionFile );
		Properties properties = new Properties();
		properties.load(fr);
		return properties;
	}

	private void addToProjectList(File projectFolder) {
		String loadedProjects = localPropertiesService.getValue( EarthProperty.LOADED_PROJECTS );
		
		if( loadedProjects.length() > 0 ){
			
			if( !ArrayUtils.contains(loadedProjects.split(File.pathSeparator), projectFolder.getAbsoluteFile() ) ){
				loadedProjects += File.pathSeparatorChar + projectFolder.getAbsolutePath();

			}
		}else{
			loadedProjects = projectFolder.getAbsolutePath();
		}		
		localPropertiesService.setValue( EarthProperty.LOADED_PROJECTS, loadedProjects );
	}


	private boolean validateProjectDefinitionFile(File projectDefinitionFile) throws IllegalArgumentException, IOException{
		boolean success = false;
		if( projectDefinitionFile.exists() ){
			if( checkValidContent(projectDefinitionFile) ){
				success = true;
			}else{
				throw new IllegalArgumentException("The project definition file does not contain the necessary property " + EarthProperty.SURVEY_NAME.toString()+ ".  File located at : " + projectDefinitionFile.getAbsolutePath() ); //$NON-NLS-1$ //$NON-NLS-2$
			}
		}
		return success;
	}
	
	
	public boolean folderContainsProjectDefinition(File folder ) throws IllegalArgumentException, IOException{
		File projectPropertiesFile = getProjectPropertiesFile( folder );		
		return validateProjectDefinitionFile(projectPropertiesFile);
	}
	
	
	public boolean loadCompressedProjectFile( File projectZipFile ) throws IllegalArgumentException, IOException, ZipException{
				
		File unzippedFolder = unzipContents(projectZipFile);
		return loadProjectInFolder(unzippedFolder);
	}


	private File unzipContents(File projectZipFile) throws ZipException, IOException {
		String projectName = getProjectName( projectZipFile );
		return unzipContents(projectZipFile, projectName);
	}
	

	private String getProjectName(File projectZipFile) throws ZipException, IOException {
		ZipFile zipFile = new ZipFile(projectZipFile);
		File definitionFolder = new File(EarthConstants.GENERATED_FOLDER);
		//FileHeader fileHeader = zipFile.getFileHeader(PROJECT_FILE_NAME);
		zipFile.extractFile( PROJECT_FILE_NAME, definitionFolder.getAbsolutePath() );		
		String projectName =  getProjectSurveyName(new File( definitionFolder + File.separator + PROJECT_FILE_NAME) );
		
		projectName = StringUtils.remove(projectName, " "); //$NON-NLS-1$
		
		if( projectName.length() > MAX_FOLDER_LENGTH ){
			projectName = projectName.substring(0, MAX_FOLDER_LENGTH);
		}
		
		return projectName;
	
	}

	public String getProjectsFolder(){
		return FolderFinder.getLocalFolder() + File.separator + PROJECTS;
	}

	private File unzipContents(File projectZipFile, String projectName) throws ZipException {
		File projectFolder = new File( getProjectsFolder() + File.separator  + projectName );
		if( projectFolder.exists() || projectFolder.mkdirs() ){		
			ZipFile zipFile = new ZipFile(projectZipFile);
			zipFile.extractAll( projectFolder.getAbsolutePath() );
		}
		return projectFolder;
	}
	
}

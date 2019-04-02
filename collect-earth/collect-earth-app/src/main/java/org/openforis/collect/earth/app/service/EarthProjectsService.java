package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

import org.apache.commons.io.FileUtils;
import org.apache.commons.io.filefilter.IOFileFilter;
import org.apache.commons.lang.ArrayUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import net.lingala.zip4j.core.ZipFile;
import net.lingala.zip4j.exception.ZipException;



@Component
public class EarthProjectsService {

	
	private static final int OLD_MAX_FOLDER_LENGTH = 20;
	
	private static final int NEW_MAX_FOLDER_LENGTH = 255;

	private static final String PROJECT_PROPERTIES_FILE_NAME = "project_definition.properties"; //$NON-NLS-1$

	private static final String PROJECTS = "projects"; //$NON-NLS-1$
	
	@Autowired
	LocalPropertiesService localPropertiesService;
	
	private Logger logger = LoggerFactory.getLogger( EarthProjectsService.class );
	
	public void init(LocalPropertiesService localPropertiesService) {
		this.localPropertiesService = localPropertiesService;
	}

	public Map<String,File> getProjectList(){
		ArrayList<File> projectFolders = getProjects();
		
		HashMap<String, File> projectListByName = new HashMap<>();
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
		Properties properties = getProjectProperties(projectPropertiesFile);
		return properties.getProperty( EarthProperty.SURVEY_NAME.toString() );
	}
	
	
	private ArrayList<File> getProjects() {
		String loadedProjects = localPropertiesService.getValue( EarthProperty.LOADED_PROJECTS );
		
		String[] projectFolderPaths = loadedProjects.split( File.pathSeparator );
		
		ArrayList<File> workingProjectFolders = new ArrayList<>(); 
		
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
	 * @return True is the project was loaded correctly
	 * @throws IOException If the project folder or one of its files cannot be found
	 */
	public boolean loadProjectInFolder(File projectFolder) throws IOException{
		
		File projectPropertiesFile = getProjectPropertiesFile( projectFolder );
		
		boolean success = false;
		
		// Change the loaded project only if the project definition file has changed or the user changes project
		if( 
				!getProjectDefinitionMD5().equals( CollectEarthUtils.getMd5FromFolder( projectFolder ) ) 
					&&
				validateProjectDefinitionFile(projectPropertiesFile) 
		){

			// Remove the version of the survey used so that it is asked again to the user!
			localPropertiesService.removeModelVersionName();
			
			Properties projectProperties = getProjectProperties( projectPropertiesFile );
			
			applyPropertiesToCollectEarth( projectProperties, projectFolder );
			
			addToProjectList(projectFolder);
			
			setProjectDefinitionMD5(projectFolder);
			
			moveSaikuQueriesToRepository(projectFolder, (String) projectProperties.get("survey_name") );
			
			success = true;
		}
		

		return success;
	}


	private void moveSaikuQueriesToRepository(File projectFolder, String surveyName) {

		try {
			Collection<File> saikuFiles = getSaikuFiles( projectFolder );
			
			String repoDirectory = "tomcat/webapps/saiku/WEB-INF/classes/saiku-repository";	
			File saikuRepo = new File( localPropertiesService.getSaikuFolder() + File.separator + repoDirectory  + File.separator + surveyName );
			
			for (File saikuFile : saikuFiles) {
				FileUtils.copyFileToDirectory(saikuFile, saikuRepo, true);
			}
		} catch (IOException e) {
			logger.error("Error moving the Saiku files", e);
		}

		
		
	}

	private Collection<File> getSaikuFiles(File projectFolder) {
		return FileUtils.listFiles(projectFolder, new IOFileFilter() {
			
			@Override
			public boolean accept(File dir, String name) {
				return name.endsWith("saiku");
			}
			
			@Override
			public boolean accept(File file) {
				
				return file.getName().endsWith("saiku");
			}
		}, null);
	}

	private void setProjectDefinitionMD5(File projectFolder) throws IOException {
		localPropertiesService.setValue( EarthProperty.ACTIVE_PROJECT_DEFINITION, CollectEarthUtils.getMd5FromFolder( projectFolder ) );
	}
	
	private String getProjectDefinitionMD5() {
		return localPropertiesService.getValue( EarthProperty.ACTIVE_PROJECT_DEFINITION);
	}
	

	public File getProjectPropertiesFile(File projectFolder) {
		return new File( projectFolder.getAbsolutePath() + File.separator + PROJECT_PROPERTIES_FILE_NAME );
	}

	public File getSurveyStructureFile(File projectFolder) {
		return new File( projectFolder.getAbsolutePath() + File.separator + PROJECT_PROPERTIES_FILE_NAME );
	}

	private void applyPropertiesToCollectEarth(Properties projectProperties, File projectFolder) {

		for (Object key : projectProperties.keySet()) {
			String value = projectProperties.getProperty((String) key);
			value = value.replace("${project_path}", projectFolder.getAbsolutePath()); //$NON-NLS-1$
			EarthProperty earthPropertyEnum = getEarthPropertyEnum(key);
			if( earthPropertyEnum != null ){
				localPropertiesService.setValue( earthPropertyEnum , value);
			}else{
				logger.warn("The property in the is unknown : {}",  key) ; //$NON-NLS-1$
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


	private boolean validateProjectDefinitionFile(File projectDefinitionFile) throws IOException{
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
	
	
	public boolean folderContainsProjectDefinition(File folder ) throws IOException{
		File projectPropertiesFile = getProjectPropertiesFile( folder );		
		return validateProjectDefinitionFile(projectPropertiesFile);
	}
	
	
	public boolean loadCompressedProjectFile( File projectZipFile ) throws IOException, ZipException{
				
		File unzippedFolder = unzipContentsOnProjectFolder(projectZipFile);
		return( loadProjectInFolder(unzippedFolder) );
	}


	private File unzipContentsOnProjectFolder(File projectZipFile) throws ZipException, IOException {
		String projectFolderName = "" ;
		// There was an error in the first versions of Collect Earth that limited the folder names to 20 characters
		// Newer version support u to 255 but we need to take in consideration backwards compatibility!
		if ( oldFormatFolderExists( projectZipFile ) ){
			// If there was already a project with the older format of the name then use that!
			projectFolderName = getProjectFolderName( projectZipFile , OLD_MAX_FOLDER_LENGTH );
		}else{
			projectFolderName = getProjectFolderName( projectZipFile , NEW_MAX_FOLDER_LENGTH );
		}		
		
		return unzipContents(projectZipFile, projectFolderName);
	}
	

	private boolean oldFormatFolderExists(File projectZipFile) throws ZipException, IOException {
		String oldProjectFolderName = getProjectFolderName( projectZipFile , OLD_MAX_FOLDER_LENGTH );
		File oldProjectFolder = new File( getProjectsFolder() + File.separator  + oldProjectFolderName );
		return oldProjectFolder.exists();
	}

	private String getProjectFolderName(File projectZipFile, int maxLenghtFolderName) throws ZipException, IOException {
		ZipFile zipFile = new ZipFile(projectZipFile);
		File definitionFolder = new File(EarthConstants.GENERATED_FOLDER);
		zipFile.extractFile( PROJECT_PROPERTIES_FILE_NAME, definitionFolder.getAbsolutePath() );		
		String projectName =  getProjectSurveyName(new File( definitionFolder + File.separator + PROJECT_PROPERTIES_FILE_NAME) );
		
		projectName = StringUtils.remove(projectName, " "); //$NON-NLS-1$
		
		if( projectName.length() > maxLenghtFolderName ){
			projectName = projectName.substring(0, maxLenghtFolderName);
		}
		
		return projectName;
	
	}

	public String getProjectsFolder(){
		return FolderFinder.getCollectEarthDataFolder() + File.separator + PROJECTS;
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

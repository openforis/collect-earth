package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStream;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

import org.apache.commons.lang3.ArrayUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.FileHeader;



@Component
public class EarthProjectsService {


	private static final int OLD_MAX_FOLDER_LENGTH = 20;

	private static final int NEW_MAX_FOLDER_LENGTH = 255;

	public static final String PROJECT_PROPERTIES_FILE_NAME = "project_definition.properties"; //$NON-NLS-1$

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
				if( projectName != null ) {
					projectListByName.put( projectName , projectFolder);
				}
			} catch (IOException e) {
				logger.error("The project definition file cannot be read.", e); //$NON-NLS-1$
			}

		}

		return projectListByName;
	}


	private String getProjectSurveyName(File projectPropertiesFile) throws IOException {
		Properties properties = getProjectProperties(projectPropertiesFile);
		if( properties != null)
			return properties.getProperty( EarthProperty.SURVEY_NAME.toString() );
		else 
			return null;
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
		return loadProjectInFolder(projectFolder, false);
	}

	/**
	 * {@link #loadProjectInFolder(File)}, saying whether the folder is a cloud project's ({@code cloudProject}: one being
	 * downloaded from its server, not bound to it yet; a folder bound to one is a cloud project's anyway).
	 */
	public boolean loadProjectInFolder(File projectFolder, boolean cloudProject) throws IOException{

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

			CloudBinding binding = localPropertiesService.getCloudBinding(projectFolder);
			applyPropertiesToCollectEarth( projectProperties, projectFolder, binding != null || cloudProject );

			CollectDBDriver driver = localPropertiesService.getCollectDBDriver();
			CollectDBDriver after = driverAfterLoading(driver, binding != null,
					CollectDBDriver.POSTGRESQL.name().equals(localPropertiesService.getValue(EarthProperty.DB_DRIVER_BEFORE_CLOUD)));
			if (after != driver) {
				localPropertiesService.saveCollectDBDriver(after);
			}
			// In a cloud project the operator is the account it is collected with
			if (binding != null && StringUtils.isNotBlank(binding.username)) {
				localPropertiesService.saveOperator(binding.username);
			}

			addToProjectList(projectFolder);

			setProjectDefinitionMD5(projectFolder);

			success = true;
		}


		return success;
	}


	/**
	 * The database of a project just loaded: the cloud mode for a folder bound to a cloud project
	 * (LocalPropertiesService.getCloudBinding), this computer's database for any other, so that each project, local or
	 * cloud, keeps its mode whatever is opened in between. PostgreSQL is left as it is.
	 * <p>
	 * A .cep imported into a bound folder (one with the same survey_name) keeps the binding: it is the same survey, and
	 * its unsent records still go to its cloud project. The import never makes it local.
	 */
	static CollectDBDriver driverAfterLoading(CollectDBDriver current, boolean cloudProject) {
		return driverAfterLoading(current, cloudProject, false);
	}

	/**
	 * {@link #driverAfterLoading(CollectDBDriver, boolean)}, for a computer that used an office's shared PostgreSQL before
	 * it joined a cloud project ({@code officeBefore}): a project that is not a cloud one goes back to that database, not
	 * to this computer's SQLite (docs/plans/2026-11-15-workflow-review.md), and the cloud project, opened again from
	 * there, is in the cloud mode again (its plots would otherwise go to the office's database and never be sent).
	 */
	static CollectDBDriver driverAfterLoading(CollectDBDriver current, boolean cloudProject, boolean officeBefore) {
		if (current == CollectDBDriver.CLOUD && !cloudProject) {
			return officeBefore ? CollectDBDriver.POSTGRESQL : CollectDBDriver.SQLITE;
		}
		if (cloudProject && (current == CollectDBDriver.SQLITE || (current == CollectDBDriver.POSTGRESQL && officeBefore))) {
			return CollectDBDriver.CLOUD;
		}
		return current;
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

	/**
	 * @param cloudProject a cloud project's: the settings its server's project file leaves out are not those of the
	 *        project loaded before it either (see {@link #keysClearedWhenLeftOut})
	 */
	private void applyPropertiesToCollectEarth(Properties projectProperties, File projectFolder, boolean cloudProject) {

		// Only the keys of the project are overwritten, so a project without a web form kept the one of the project
		// loaded before it, and the plots map showed the form of another survey
		if (!projectProperties.containsKey(EarthProperty.BALLOON_TEMPLATE_KEY_WEB.toString())) {
			localPropertiesService.setValue(EarthProperty.BALLOON_TEMPLATE_KEY_WEB, ""); //$NON-NLS-1$
		}
		// Nor does a project with no balloon at all (its form is made from its survey, as the demo's) keep the balloon
		// of the project before, which web_form=balloon would then show for another survey
		if (!projectProperties.containsKey(EarthProperty.BALLOON_TEMPLATE_KEY.toString())) {
			localPropertiesService.setValue(EarthProperty.BALLOON_TEMPLATE_KEY, ""); //$NON-NLS-1$
		}
		// Nor does a project that does not number its sample points keep the numbers of the one before
		if (!projectProperties.containsKey(EarthProperty.SAMPLE_POINT_NUMBERS.toString())) {
			localPropertiesService.setValue(EarthProperty.SAMPLE_POINT_NUMBERS, ""); //$NON-NLS-1$
		}
		// Nor the guide of the survey before
		if (!projectProperties.containsKey(EarthProperty.SURVEY_GUIDE_URL.toString())) {
			localPropertiesService.setValue(EarthProperty.SURVEY_GUIDE_URL, ""); //$NON-NLS-1$
		}
		// Nor the Explorer window of the survey before
		if (!projectProperties.containsKey(EarthProperty.EXPLORER_CONFIG.toString())) {
			localPropertiesService.setValue(EarthProperty.EXPLORER_CONFIG, ""); //$NON-NLS-1$
		}
		for (EarthProperty key : keysClearedWhenLeftOut(cloudProject)) {
			if (!projectProperties.containsKey(key.toString())) {
				localPropertiesService.setValue(key, ""); //$NON-NLS-1$
			}
		}

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

	/**
	 * The settings of a project loaded that are cleared when its project file does not have them, beyond the web
	 * balloon, the sample point numbers and the Explorer window (cleared for every project). In a cloud project: its plot
	 * file ({@code csv}), which the project files its server makes leave out (the person's plots are downloaded after,
	 * MyPlotsService), so the plot file of the project open before is not shown when none could be downloaded; and the
	 * form ({@code web_form}), so a project file that no longer asks for its balloon (its survey changed in the
	 * dashboard's designer) shows the form made from its survey. A local project keeps them as before: its plot file
	 * is one the person may have chosen.
	 */
	static EarthProperty[] keysClearedWhenLeftOut(boolean cloudProject) {
		return cloudProject ? new EarthProperty[] { EarthProperty.SAMPLE_FILE, EarthProperty.WEB_FORM } : new EarthProperty[0];
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
		try( FileReader fr = new FileReader( definitionFile ) ){
			Properties properties = new Properties();
			properties.load(fr);
			return properties;
		}catch(IOException e ) {
			logger.error("Impossible to open properties file ", e);
			throw e;
		}
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


	public boolean loadCompressedProjectFile( File projectZipFile ) throws IOException{
		return loadCompressedProjectFile(projectZipFile, false);
	}

	/** {@link #loadCompressedProjectFile(File)} of a cloud project's file, downloaded from its server ({@code cloudProject}) */
	public boolean loadCompressedProjectFile( File projectZipFile, boolean cloudProject ) throws IOException{
		String refusal = refusalOf(projectZipFile);
		if (refusal != null) {
			throw new IOException(refusal);
		}
		File unzippedFolder = unzipContentsOnProjectFolder(projectZipFile);
		return( loadProjectInFolder(unzippedFolder, cloudProject) );
	}


	private File unzipContentsOnProjectFolder(File projectZipFile) throws IOException {
		return unzipContents(projectZipFile, projectFolderName(projectZipFile));
	}

	private String projectFolderName(File projectZipFile) throws IOException {
		// There was an error in the first versions of Collect Earth that limited the folder names to 20 characters
		// Newer version support up to 255 but we need to take in consideration backwards compatibility!
		if ( oldFormatFolderExists( projectZipFile ) ){
			// If there was already a project with the older format of the name then use that!
			return getProjectFolderName( projectZipFile , OLD_MAX_FOLDER_LENGTH );
		}
		return getProjectFolderName( projectZipFile , NEW_MAX_FOLDER_LENGTH );
	}

	/** The setting of a project file made for working alone, with plots, from a cloud project (the cloud's standaloneCep.ts) */
	static final String CLOUD_STANDALONE = "cloud_standalone"; //$NON-NLS-1$

	/**
	 * Why a project file is not opened, or null. One made for working alone (downloaded from a cloud project with its
	 * plots) is refused on a computer that has its survey as a cloud project: unzipped into that cloud project's folder
	 * it would stay the cloud project (see driverAfterLoading), its plots unused and the folder's files replaced, and
	 * Collect Earth would say nothing. The cloud project works without internet too, with the person's plots.
	 */
	String refusalOf(File projectZipFile) throws IOException {
		if (!madeForWorkingAlone(projectZipFile)) {
			return null;
		}
		CloudBinding bound = localPropertiesService.getCloudBinding(projectFolderFor(projectZipFile));
		if (bound == null) {
			return null;
		}
		return MessageFormat.format(Messages.getString("EarthProjectsService.standaloneInCloud"), //$NON-NLS-1$
				StringUtils.defaultIfBlank(bound.projectName, bound.projectId));
	}

	/** Whether a project file's settings say it was made for working alone ({@link #CLOUD_STANDALONE}) */
	static boolean madeForWorkingAlone(File projectZipFile) throws IOException {
		try (ZipFile zip = new ZipFile(projectZipFile)) {
			FileHeader header = zip.getFileHeader(PROJECT_PROPERTIES_FILE_NAME);
			if (header == null) {
				return false;
			}
			Properties settings = new Properties();
			try (InputStream in = zip.getInputStream(header)) {
				settings.load(in);
			}
			return Boolean.parseBoolean(StringUtils.trim(settings.getProperty(CLOUD_STANDALONE)));
		}
	}

	/** The folder a project file is unzipped into (its survey_name under the projects folder), before it is. */
	public File projectFolderFor(File projectZipFile) throws IOException {
		String name = projectFolderName(projectZipFile);
		if( StringUtils.isBlank( name ) ){
			throw new IOException("The project file " + projectZipFile.getAbsolutePath() + " does not define a survey_name"); //$NON-NLS-1$ //$NON-NLS-2$
		}
		return new File( new File( getProjectsFolder() ).getCanonicalFile(), name ).getCanonicalFile();
	}


	private boolean oldFormatFolderExists(File projectZipFile) throws IOException {
		String oldProjectFolderName = getProjectFolderName( projectZipFile , OLD_MAX_FOLDER_LENGTH );
		File oldProjectFolder = new File( getProjectsFolder() + File.separator  + oldProjectFolderName );
		return oldProjectFolder.exists();
	}

	private String getProjectFolderName(File projectZipFile, int maxLenghtFolderName) throws IOException {
		try( ZipFile zipFile = new ZipFile(projectZipFile) ){
			File definitionFolder = new File(EarthConstants.GENERATED_FOLDER);
			zipFile.extractFile( PROJECT_PROPERTIES_FILE_NAME, definitionFolder.getAbsolutePath() );
			String projectName =  getProjectSurveyName(new File( definitionFolder + File.separator + PROJECT_PROPERTIES_FILE_NAME) );
			if( projectName != null ) {
				projectName = StringUtils.remove(projectName, " "); //$NON-NLS-1$
	
				if( projectName.length() > maxLenghtFolderName ){
					projectName = projectName.substring(0, maxLenghtFolderName);
				}
			}
			return projectName;
		}catch(IOException e ) {
			// Usually not a project at all : a CSV or a KML chosen by mistake. This used to be logged here at ERROR and
			// turned into null, which the caller then reported as a project with no survey_name - so one wrong file gave
			// two errors in Sentry and a message that did not say what was wrong (JAVA-COLLECT-EARTH-55N, 55P)
			throw new IOException(projectZipFile.getName() + " is not a Collect Earth project file (.cep) : " + e.getMessage(), e); //$NON-NLS-1$
		}

	}

	public String getProjectsFolder(){
		return FolderFinder.getCollectEarthDataFolder() + File.separator + PROJECTS;
	}

	private File unzipContents(File projectZipFile, String projectName) throws IOException {
		if( StringUtils.isBlank( projectName ) ){
			throw new IOException("The project file " + projectZipFile.getAbsolutePath() + " does not define a survey_name"); //$NON-NLS-1$ //$NON-NLS-2$
		}

		final File projectsFolder = new File( getProjectsFolder() ).getCanonicalFile();
		final File projectFolder = new File( projectsFolder, projectName ).getCanonicalFile();
		// The name comes from inside the archive ( survey_name ) : it has to be a single folder directly under the projects folder,
		// otherwise a name like ".." would extract the archive somewhere else
		if( !projectsFolder.equals( projectFolder.getParentFile() ) ){
			throw new IOException("The survey_name '" + projectName + "' of " + projectZipFile.getAbsolutePath() + " is not a valid folder name"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		}

		if( !projectFolder.exists() && !projectFolder.mkdirs() ){
			throw new IOException("Could not create the project folder " + projectFolder.getAbsolutePath()); //$NON-NLS-1$
		}

		// Let a failed extraction reach the caller, otherwise the ( possibly stale ) folder would be loaded as if the import had worked
		try( ZipFile zipFile = new ZipFile(projectZipFile) ){
			zipFile.extractAll( projectFolder.getAbsolutePath() );
		}
		return projectFolder;
	}

}

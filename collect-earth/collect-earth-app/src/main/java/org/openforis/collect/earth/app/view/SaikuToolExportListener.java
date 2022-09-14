package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.io.File;
import java.io.IOException;

import javax.swing.JFrame;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.ZipParameters;

public class SaikuToolExportListener extends SaikuAnalysisListener {
	private Logger logger = LoggerFactory.getLogger( SaikuToolExportListener.class);
	private LocalPropertiesService localPropertiesService;

	private final static String PREFIX_FOLDER = "saiku-server_2.6";

	public SaikuToolExportListener(JFrame frame, GenerateDatabaseStarter saikuStarter, LocalPropertiesService localPropertiesService) {
		super(frame, saikuStarter);
		this.localPropertiesService = localPropertiesService;
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		try {
			
			File[] exportToFile = JFileChooserExistsAware.getFileChooserResults(DataFormat.SAIKU_ZIP, true, false, "SaikuTool",	localPropertiesService, frame);

			if (exportToFile != null && exportToFile.length > 0) {
				CollectEarthWindow.startWaiting(frame);
				exportDataToRDB(false);	
				generateNewSaikuZip( exportToFile[0] );
			}

		}catch (Exception e1) {
			logger.error("Error starting Saiku server", e1); //$NON-NLS-1$
		} finally{
			CollectEarthWindow.endWaiting(frame);
		}
	}

	private void generateNewSaikuZip(File zipFileOutput ) {

			try (
				ZipFile outputSaikuZip = new ZipFile(zipFileOutput);
			){
				File saikuFolder = new File(localPropertiesService.getSaikuFolder() );
				File javaFolder = new File( saikuFolder.getAbsolutePath() + "/../java" ); // The Java and Saiku folders are on the same level

				ZipParameters zipParameters = new ZipParameters();
				zipParameters.setExcludeFileFilter(  
						file -> 
							file.getName().endsWith( "log")  // exclude log files!
							||
							file.getParent().endsWith("temp" )  // exclude temp folder!
						);
				outputSaikuZip.addFolder( saikuFolder, zipParameters );
				
				// Copy the original ZIP files contained in the root ( saiku-server_2.6.zip ) to a new temporary file

				// create DB folder
				// Copy the Saiku DB to DB/collectEarthDatabase.dbSaiku
				zipParameters.setFileNameInZip(PREFIX_FOLDER+"/DB/" + EarthConstants.COLLECT_EARTH_DATABASE_FILE_NAME
						+ EarthConstants.SAIKU_RDB_SUFFIX);
				outputSaikuZip.addFile(
						new File(AnalysisSaikuService.COLLECT_EARTH_DATABASE_RDB_DB), zipParameters
						);

				// Copy the Mondrian Cube XML to DB/collectEarthCubes.xml
				zipParameters = new ZipParameters();
				zipParameters.setFileNameInZip(PREFIX_FOLDER+"/DB/" + AnalysisSaikuService.MDX_XML );
				File mdxFile = new File(localPropertiesService.getProjectFolder() + File.separatorChar + AnalysisSaikuService.MDX_XML);
				outputSaikuZip.addFile(
						mdxFile, zipParameters
						);


				// Change the configuration file to use the stand alone version!

				// Add java to the Saiku ZIP
				zipParameters = new ZipParameters();
				zipParameters.setRootFolderNameInZip(PREFIX_FOLDER  );
				outputSaikuZip.addFolder( javaFolder, zipParameters );
				
				
				// Move START_SAIKU and TERMINATE SAIKU to the root folder
				File startSaiku = new File("resources/START SAIKU.bat");
				outputSaikuZip.addFile(
						startSaiku
						);

				File terminateSaiku = new File("resources/TERMINATE SAIKU.bat");
				outputSaikuZip.addFile(
						terminateSaiku
						);
				
				File readme = new File("resources/README - INSTALLATION AND RUNNING.txt");
				outputSaikuZip.addFile(
						readme
						);
				
				

				
			} catch (IOException e) {
				logger.error("Error generating SAIKu tool at " + zipFileOutput.getAbsolutePath() );
			}
	}

}

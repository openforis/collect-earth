package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.io.File;
import java.io.IOException;

import javax.swing.JFrame;

import org.openforis.collect.earth.app.CollectEarthUtils;
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

	private final AnalysisSaikuService saikuService;

	public SaikuToolExportListener(JFrame frame, GenerateDatabaseStarter saikuStarter, LocalPropertiesService localPropertiesService,
			AnalysisSaikuService saikuService) {
		super(frame, saikuStarter);
		this.localPropertiesService = localPropertiesService;
		this.saikuService = saikuService;
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		try {

			File[] exportToFile = FileChooserUtils.getFileChooserResults(DataFormat.SAIKU_ZIP, true, false, "SaikuTool",	localPropertiesService, frame);

			if (exportToFile != null && exportToFile.length > 0) {
				CollectEarthWindow.startWaiting(frame);
				
				generateNewSaikuZip( exportToFile[0] );
			}

		}catch (Exception e1) {
			logger.error("Error starting Saiku server", e1); //$NON-NLS-1$
		} finally{
			CollectEarthWindow.endWaiting(frame);
		}
	}

	private void generateNewSaikuZip(File zipFileOutput ) {
		InfiniteProgressMonitor progressMonitor = new InfiniteProgressMonitor( 
				frame, 
				Messages.getString("SaikuToolExportListener.1"), 
				Messages.getString("SaikuToolExportListener.2")			
			);
		
		Thread threadGeneratingDB = new Thread("Generating ZIP Saiku Tool"){ //$NON-NLS-1$
			@Override
			public void run() {
				exportDataToRDB(false);
				try {
					saikuService.buildStandaloneTool(zipFileOutput);
				} catch (IOException e) {
					logger.error("Error generating SAIKU tool at " + zipFileOutput.getAbsolutePath(), e);
				} finally{
					if( progressMonitor != null ){
						progressMonitor.close();
					}
					
					CollectEarthUtils.openFile( zipFileOutput );
				}
			}
		};

		threadGeneratingDB.start();

		progressMonitor.showLater();		


	}
}

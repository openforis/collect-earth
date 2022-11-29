package org.openforis.collect.earth.app.service;

import org.openforis.collect.earth.app.view.InfiniteProgressMonitor;
import org.openforis.collect.earth.ipcc.IPCCGenerator;
import org.openforis.collect.earth.ipcc.IPCCGeneratorException;
import org.openforis.collect.earth.ipcc.RdbExportException;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.relational.CollectRDBPublisher;
import org.openforis.collect.relational.CollectRdbException;
import org.openforis.idm.metamodel.NodeDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class IPCCGeneratorService extends GenerateDatabase{

	@Autowired
	RDBExporter rdbExporter;
	
	@Autowired
	CollectRDBPublisher collectRDBPublisher;

	@Autowired
	EarthSurveyService earthSurveyService;

	@Autowired
	public LocalPropertiesService localPropertiesService;

	@Autowired
	BrowserService browserService;

	@Autowired
	private IPCCGenerator ipccGenerator;
	
	final Logger logger = LoggerFactory.getLogger(IPCCGeneratorService.class);

	public void prepareDataForAnalysis(InfiniteProgressMonitor progressListener, boolean startSaikuAfterDBExport) throws RdbExportException {

		try {

			try {

				if (
						(localPropertiesService.isUsingSqliteDB() && !getZippedProjectDB( ExportType.IPCC ).exists())
						|| 
						isRefreshDatabase()
				) {
					
					// The user clicked on the option to refresh the database, or there is no
					// previous copy of the Saiku DB
					// Generate the DB file
					ipccGenerator.generateRDB( earthSurveyService.getCollectSurvey(), progressListener);
			
					try {
						// Save the DB file in a zipped file to extends GenerateDatabase keep for the next usages
						replaceZippedProjectDB( ExportType.IPCC );
					} catch (Exception e) {
						logger.error("Error while refreshing the Zipped content of the project IPCC DB", e);
					}

				} else if (getZippedProjectDB(ExportType.IPCC).exists()) {
					// If the zipped version of the project exists ( and the user clicked on the
					// option to not refresh it) then restore this last version of the data
					if (localPropertiesService.isUsingSqliteDB()) {
						restoreZippedProjectDB(ExportType.IPCC);
					}
				}
				
				ipccGenerator.produceOutputs( earthSurveyService.getCollectSurvey(),  progressListener );

			} catch (final IPCCGeneratorException e) {
				logger.error("Error while producing Relational DB from Collect format", e); //$NON-NLS-1$
			} 

		} catch (final CollectRdbException e) {
			logger.error("Error while producing Relational DB from Collect format", e); //$NON-NLS-1$
		}
	}



	public static boolean surveyContains(String nodeName, CollectSurvey survey) {
		NodeDefinition nodeDefForNAme = survey.getSchema().findNodeDefinition( nodeDef -> nodeDef.getName().equals(nodeName) );
		return nodeDefForNAme != null;
	}


	@Override
	public LocalPropertiesService getLocalPropertiesService() {
		return localPropertiesService;
	}

	@Override
	public EarthSurveyService getEarthSurveyService() {
		return earthSurveyService;
	}

	@Override
	public RDBExporter getRdbExporter() {
		return rdbExporter;
	}

}
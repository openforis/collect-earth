/**
 * Main class to generate the IPCC Inventory Software compliant file
 */
package org.openforis.collect.earth.ipcc;

import java.io.File;

import org.openforis.collect.earth.app.view.InfiniteProgressMonitor;
import org.openforis.idm.metamodel.Survey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus
 *
 */
@Component
public class IPCCGenerator {

	@Autowired
	IPCCRDBGenerator ipccRdbGenerator;

	IPCCSurveyAdapter ipccSurveyAdapter;

	Logger logger = LoggerFactory.getLogger( IPCCGenerator.class );

	public File generateIPCCFile( Survey survey, InfiniteProgressMonitor progressListener) throws IPCCGeneratorException {

		ipccSurveyAdapter = new IPCCSurveyAdapter();

		// Add attributes for each year containing the LU Category and Subdivision if not present
		Survey modifiedSurvey = ipccSurveyAdapter.addIPCCAttributesToSurvey( survey );

		// Generate Relational Database of the survey data
		ipccRdbGenerator.generateRelationalDatabase( modifiedSurvey, progressListener);
/*
		// Extract data from the Relational Database into a CSV File
		File csvFileTimeseries = generateCSVTimeseries();

		// Convert CSV time-series into XML compliant format
		File xmlFormattedFile = convertCSVtoXML(csvFileTimeseries);

		return signXMLFile( xmlFormattedFile );
*/ 
		return null;
	}

	private File signXMLFile(File xmlFormattedFile) {
		// TODO Auto-generated method stub
		return null;
	}

	private File convertCSVtoXML(File csvFileTimeseries) {
		// TODO Auto-generated method stub
		return null;
	}

	private File generateCSVTimeseries() {
		// TODO Auto-generated method stub
		return null;
	}





}

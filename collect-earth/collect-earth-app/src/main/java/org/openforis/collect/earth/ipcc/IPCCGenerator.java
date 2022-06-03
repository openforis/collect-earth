/**
 * Main class to generate the IPCC Inventory Software compliant file
 */
package org.openforis.collect.earth.ipcc;

import java.io.File;

import org.openforis.collect.earth.app.view.InfiniteProgressMonitor;
import org.openforis.idm.metamodel.Survey;

/**
 * @author Alfonso Sanchez-Paus
 *
 */
public class IPCCGenerator {
	
	public File generateIPCCFile( Survey survey, InfiniteProgressMonitor progressListener) {
		
		// Add attributes for each year containing the LU Category and Subdivision if not present
		Survey modifiedSurvey = addIPCCAttributesToSurvey( survey );
		
		// Generate Relational Database of the survey data
		File sqLiteDBFile = generateSQLiteRelationalDatabase( modifiedSurvey)
		
		// Extract data from the Relational Database into a CSV File
		File csvFileTimeseries = generateCSVTimeseries( sqLiteDBFile );
		
		// Convert CSV time-series into XML compliant format
		File xmlFormattedFile = convertCSVtoXML(csvFileTimeseries);
		
		return signXMLFile( xmlFormattedFile );
	}

	private File signXMLFile(File xmlFormattedFile) {
		// TODO Auto-generated method stub
		return null;
	}

	private File convertCSVtoXML(File csvFileTimeseries) {
		// TODO Auto-generated method stub
		return null;
	}

	private File generateCSVTimeseries(File sqLiteDBFile) {
		// TODO Auto-generated method stub
		return null;
	}

	private File generateSQLiteRelationalDatabase(Survey modifiedSurvey) {
		// TODO Auto-generated method stub
		return null;
	}

	private Survey addIPCCAttributesToSurvey(Survey survey) {
		// TODO Auto-generated method stub
		return null;
	}

}

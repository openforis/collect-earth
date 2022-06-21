/**
 * Main class to generate the IPCC Inventory Software compliant file
 */
package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.util.Calendar;

import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.DataFormat;
import org.openforis.collect.earth.app.view.InfiniteProgressMonitor;
import org.openforis.collect.earth.app.view.JFileChooserExistsAware;
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
	
	@Autowired
	IPCCDataExportTimeSeriesCSV ipccDataExportToCSV;
	
	@Autowired
	LocalPropertiesService localPropertiesService;

	@Autowired
	IPCCDataExportMatrixExcel dataExportMatrixExcel;
	
	IPCCSurveyAdapter ipccSurveyAdapter;

	Logger logger = LoggerFactory.getLogger( IPCCGenerator.class );

	public static final int END_YEAR = Calendar.getInstance().get(Calendar.YEAR); // Assume the last year is current year
	public static final int START_YEAR = 2000;  // Assume start year at 2000

	public File generateIPCCFile( Survey survey, InfiniteProgressMonitor progressListener) throws IPCCGeneratorException {

		ipccSurveyAdapter = new IPCCSurveyAdapter();

		// Add attributes for each year containing the LU Category and Subdivision if not present
		Survey modifiedSurvey = ipccSurveyAdapter.addIPCCAttributesToSurvey( survey );

		// Generate Relational Database of the survey data
		ipccRdbGenerator.generateRelationalDatabase( modifiedSurvey, progressListener);


		File[] exportToFile = JFileChooserExistsAware.getFileChooserResults(DataFormat.GHGI_XML_FILE, true, false, "LandUseForGHGi", localPropertiesService, null);
		
		if( exportToFile.length == 0 )
			return null;
		
		// Extract data from the Relational Database into a CSV File
		ipccDataExportToCSV.generateTimeseriesData( exportToFile[0], IPCCGenerator.START_YEAR, IPCCGenerator.END_YEAR );

/* EXCEL MATRIXES		
		dataExportMatrixExcel.generateTimeseriesData(null, START_YEAR, END_YEAR);
*/		

		
/*
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

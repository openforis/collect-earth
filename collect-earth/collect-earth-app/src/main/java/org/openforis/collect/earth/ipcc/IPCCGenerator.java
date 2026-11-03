/**
 * Main class to generate the IPCC Inventory Software compliant file
 */
package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.SchemaService;
import org.openforis.collect.earth.app.service.AnalysisProgress;
import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.controller.StratumUtils;
import org.openforis.collect.manager.SurveyManager;
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
	IPCCDataExportTimeSeriesXML ipccDataExportToXML;

	@Autowired
	LocalPropertiesService localPropertiesService;

	@Autowired
	IPCCDataExportMatrixExcel dataExportMatrixExcel;

	@Autowired
	IPCCDataExportMatrixExtendedExcel dataExportMatrixExtendedExcel;

	@Autowired
	IPCCDataExportLandUnitsCSV dataExportLandUnitsCSV;

	@Autowired
	IPCCDataExportPerPlotCSV dataExportPerPlotCSV;

	@Autowired
	SamplingUncertaintyGenerator sampligUncertaintyGenerator;
	
	@Autowired
	IPCCDataExportTimeSeriesToTool dataExportTimeSeriesToTool;

	@Autowired
	SurveyManager surveyManager;
	
	@Autowired
	IPCCLandUses landUses;

	IPCCSurveyAdapter ipccSurveyAdapter;

	Logger logger = LoggerFactory.getLogger(IPCCGenerator.class);

	public static final int END_YEAR = 2023; // Calendar.getInstance().get(Calendar.YEAR); // Assume the last year is
												// current year
	public static final int START_YEAR = 2000; // Assume start year at 2000

	public File generateRDB(Survey survey, AnalysisProgress progressListener) throws IPCCGeneratorException {

		ipccSurveyAdapter = new IPCCSurveyAdapter( landUses );
		
		// Add attributes for each year containing the LU Category and Subdivision if
		// not present
		Survey modifiedSurvey = ipccSurveyAdapter.addIPCCAttributesToSurvey(survey);

		/*
		 * CODE NOT NECESSARY, JUST USED TO CHECK IDML SURVEY FILE try( FileOutputStream
		 * fos = new FileOutputStream( "surveyModified.xml" ) ) {
		 * surveyManager.marshalSurvey(modifiedSurvey, fos ); } catch
		 * (FileNotFoundException e) { logger.error( "Error marshalling survey", e ); }
		 * catch (IOException e) { logger.error( "Error marshalling survey", e ); }
		 */
		// Generate Relational Database of the survey data
		ipccRdbGenerator.generateRelationalDatabase(modifiedSurvey, progressListener);

		return null;
	}

	/**
	 * The outputs of the package into the ZIP, from the subdivisions as they were assigned (LandUseSubdivisionUtils):
	 * what the wizard and the file dialog used to be asked for comes as arguments, from the Swing path of
	 * IPCCGeneratorService or from the form of the page.
	 *
	 * @param countryCode     the ISO code of the country
	 * @param regionAttribute the attribute of the survey that holds the region
	 */
	public void produceOutputs(Survey survey, String countryCode, String regionAttribute, File destinationZip, AnalysisProgress progressListener)
			throws IOException, IPCCGeneratorException {

			final int STEPS = 9;
			int currentStep = 1;

			progressListener.show();
			// Hide it whatever happens next : the eight cancel returns below, and any failure, used to leave the monitor on screen
			try {

				progressListener.updateProgress(currentStep++, STEPS, "Generating CSV aggregated time-series");
				// Extract data from the Relational Database into an excel file of transition
				// Matrixes per year
				File landUnitsCSVFile = dataExportLandUnitsCSV.generateTimeseriesData(START_YEAR, END_YEAR);
				if (progressListener.isUserCancelled())
					return;

				progressListener.updateProgress(currentStep++, STEPS, "Generating CSV per plot time-series");
				// Extract data from the Relational Database into an excel file of transition
				// Matrixes per year
				File perPlotCSVFile = dataExportPerPlotCSV.generateTimeseriesData(START_YEAR, END_YEAR);
				if (progressListener.isUserCancelled())
					return;
			
				progressListener.updateProgress(currentStep++, STEPS, "Generating sampling uncertainty analysis");
				// Extract data from the Relational Database into an excel file of transition
				// Matrixes per year
				File samplingUncertainty = sampligUncertaintyGenerator.getSamplingUncertainty(START_YEAR, END_YEAR);
				if (progressListener.isUserCancelled())
					return;

				progressListener.updateProgress(currentStep++, STEPS, "Generating survey setup files");
				// Generate list of subdivisions in survey
				File subdivisionsFile = LandUseSubdivisionUtils.getSubdivisionsXML();
				File climateZones = StratumUtils.getClimateZonesXML(survey);
				File ecologicalZones = StratumUtils.getEcologicalZonesXML(survey);
				File soilTypes = StratumUtils.getSoilTypesXML(survey);
				if (progressListener.isUserCancelled())
					return;

				progressListener.updateProgress(currentStep++, STEPS, "Generating XML timeseries file");
				// Extract data from the Relational Database into an XML File with information
				// per year
				File timeseriesXMLFile = ipccDataExportToXML.generateTimeseriesData(IPCCGenerator.START_YEAR,
						IPCCGenerator.END_YEAR);
				if (progressListener.isUserCancelled())
					return;

				progressListener.updateProgress(currentStep++, STEPS, "Generating Excel LU Matrixes per year");
				// Extract data from the Relational Database into an excel file of transition
				// Matrixes per year
				File matrixXLSFile = dataExportMatrixExcel.generateTimeseriesData(START_YEAR, END_YEAR);
				if (progressListener.isUserCancelled())
					return;

				progressListener.updateProgress(currentStep++, STEPS, "Generating Excel LU Matrixes per year STRATIFIED");
				// Extract data from the Relational Database into an excel file of transition
				// Matrixes per year
				File matrixXLSExtendedFile = dataExportMatrixExtendedExcel.generateTimeseriesData(START_YEAR, END_YEAR);
				if (progressListener.isUserCancelled())
					return;

				progressListener.updateProgress(currentStep++, STEPS, "Generating GHGi activity data files");
				// Extract data from the Relational Database into an excel file of transition
				// Matrixes per year
				File xmlWithDataToImportGhgTool = dataExportTimeSeriesToTool.generateTimeseriesData(START_YEAR, START_YEAR,
						END_YEAR, countryCode, regionAttribute);
				if (progressListener.isUserCancelled())
					return;

				progressListener.updateProgress(currentStep++, STEPS, "Compressing files into selected destination");
				CollectEarthUtils.addFileToZip(destinationZip, timeseriesXMLFile, "LU_Timeseries.xml");
				CollectEarthUtils.addFileToZip(destinationZip, matrixXLSFile, "LU_Matrixes.xls");
				CollectEarthUtils.addFileToZip(destinationZip, matrixXLSExtendedFile, "LU_Matrixes_stratified.xls");
				CollectEarthUtils.addFileToZip(destinationZip, subdivisionsFile, "ConfigLandUseSubdivisions.xml");
				CollectEarthUtils.addFileToZip(destinationZip, climateZones, "ConfigClimateZones.xml");
				CollectEarthUtils.addFileToZip(destinationZip, ecologicalZones, "ConfigEclogicalZones.xml");
				CollectEarthUtils.addFileToZip(destinationZip, soilTypes, "ConfigSoilTypes.xml");
				CollectEarthUtils.addFileToZip(destinationZip, landUnitsCSVFile, "LU_Timeseries_grouped.csv");
				CollectEarthUtils.addFileToZip(destinationZip, perPlotCSVFile, "LU_Timeseries_per_plot.csv");
				CollectEarthUtils.addFileToZip(destinationZip, xmlWithDataToImportGhgTool, "GHGi_tool_data.xml");
				if (samplingUncertainty != null) {
					CollectEarthUtils.addFileToZip(destinationZip, samplingUncertainty, "SamplingUncertainty.xlsx");
				} else {
					logger.error("The sampling uncertainty analysis could not be generated, it is missing from {}", destinationZip); //$NON-NLS-1$
				}

			} finally {
				progressListener.hide();
			}
	}

}

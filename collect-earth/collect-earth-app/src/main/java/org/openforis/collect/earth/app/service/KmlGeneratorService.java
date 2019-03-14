package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.processor.CircleKmlGenerator;
import org.openforis.collect.earth.sampler.processor.HexagonKmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmzGenerator;
import org.openforis.collect.earth.sampler.processor.NfiCirclesKmlGenerator;
import org.openforis.collect.earth.sampler.processor.NfmaKmlGenerator;
import org.openforis.collect.earth.sampler.processor.PolygonKmlGenerator;
import org.openforis.collect.earth.sampler.processor.SquareKmlGenerator;
import org.openforis.collect.earth.sampler.processor.SquareWithCirclesKmlGenerator;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import au.com.bytecode.opencsv.CSVReader;
import freemarker.template.TemplateException;

@Component
public class KmlGeneratorService {

	@Autowired
	LocalPropertiesService localPropertiesService;
	
	@Autowired
	EarthSurveyService earthSurveyService;

	Logger logger = LoggerFactory.getLogger(KmlGeneratorService.class);

	public static final String KML_RESULTING_TEMP_FILE = EarthConstants.GENERATED_FOLDER + File.separator + "plots.kml"; //$NON-NLS-1$
	public static final String KMZ_FILE_PATH = EarthConstants.GENERATED_FOLDER + File.separator + "gePlugin.kmz"; //$NON-NLS-1$
	public static final String KML_NETWORK_LINK_TEMPLATE = "resources/loadApp.fmt"; //$NON-NLS-1$
	public static final String KML_NETWORK_LINK_STARTER = EarthConstants.GENERATED_FOLDER + "/loadApp.kml"; //$NON-NLS-1$


	public void generateKmlFile() throws IOException, KmlGenerationException{
		checkFilesExist();
		generatePlacemarksKmzFile();

	}

	private void checkFilesExist() throws KmlGenerationException {

		fixUserDirectory();

		final String csvFilePath = getLocalProperties().getCsvFile();
		final String balloonPath = getLocalProperties().getBalloonFile();
		final String templatePath = getLocalProperties().getTemplateFile();
		boolean filesExist = true;
		String errorMessage = "<html>Error generating the KML file for Google Earth.<br/>"; //$NON-NLS-1$
		File csvFile = null;
		File balloon = null;
		File template = null;
		try {
			csvFile = new File(csvFilePath);
			balloon = new File(balloonPath);
			template = new File(templatePath);
		} catch (final Exception e) {
			logger.error("One of the definition files is not defined", e); //$NON-NLS-1$
		}
		if (csvFile != null && !csvFile.exists()) {
			errorMessage += Messages.getString("EarthApp.21") //$NON-NLS-1$
					+ csvFile.getAbsolutePath() + "</i><br/><br/>"; //$NON-NLS-1$
			filesExist = false;
		} else if (csvFile == null) {
			errorMessage += Messages.getString("EarthApp.23"); //$NON-NLS-1$
			filesExist = false;
		}

		if (template != null && !template.exists()) {
			errorMessage += Messages.getString("EarthApp.24") //$NON-NLS-1$
					+ template.getAbsolutePath() + "</i><br/><br/>"; //$NON-NLS-1$
			filesExist = false;
		} else if (template == null) {
			errorMessage += Messages.getString("EarthApp.26"); //$NON-NLS-1$
			filesExist = false;
		}

		if (balloon != null && !balloon.exists()) {
			errorMessage += Messages.getString("EarthApp.27") + balloon.getAbsolutePath() //$NON-NLS-1$
					+ "</i><br/><br/>"; //$NON-NLS-1$
			filesExist = false;
		} else if (balloon == null) {
			errorMessage += Messages.getString("EarthApp.29"); //$NON-NLS-1$
			filesExist = false;
		}

		errorMessage += Messages.getString("EarthApp.30"); //$NON-NLS-1$

		if( !filesExist ){
			throw new KmlGenerationException(errorMessage);
		}
	}

	private LocalPropertiesService getLocalProperties() {
		return localPropertiesService;
	}

	private void copyContentsToGeneratedFolder(String folderToInclude) throws IOException {
		final File sourceDir = new File(folderToInclude);
		final File targetDir = new File(EarthConstants.GENERATED_FOLDER + File.separator + sourceDir.getName());
		FileUtils.copyDirectory(sourceDir, targetDir);
	}

	private void fixUserDirectory() {
		final String csvFilePath = getLocalProperties().getCsvFile();
		final String balloonPath = getLocalProperties().getBalloonFile();
		final String templatePath = getLocalProperties().getTemplateFile();
		final String metadataPath = getLocalProperties().getImdFile();

		File csvFile = null;
		File balloon = null;
		File template = null;
		File idmFile = null;
		try {
			csvFile = new File(csvFilePath);
			balloon = new File(balloonPath);
			template = new File(templatePath);
			idmFile = new File(metadataPath);

			final String prefixUserFolder = FolderFinder.getCollectEarthDataFolder() + File.separator;

			if (!csvFile.exists()) {
				final File otherFile = new File(prefixUserFolder + getLocalProperties().getCsvFile());
				if (otherFile.exists()) {
					getLocalProperties().setValue(EarthProperty.SAMPLE_FILE, otherFile.getAbsolutePath());
				}
			}

			if (!balloon.exists()) {
				final File otherFile = new File(prefixUserFolder + getLocalProperties().getBalloonFile());
				if (otherFile.exists()) {
					getLocalProperties().setValue(EarthProperty.BALLOON_TEMPLATE_KEY, otherFile.getAbsolutePath());
				}
			}

			if (!template.exists()) {
				final File otherFile = new File(prefixUserFolder + getLocalProperties().getTemplateFile());
				if (otherFile.exists()) {
					getLocalProperties().setValue(EarthProperty.KML_TEMPLATE_KEY, otherFile.getAbsolutePath());
				}
			}

			if (!idmFile.exists()) {
				final File otherFile = new File(prefixUserFolder + getLocalProperties().getImdFile());
				if (otherFile.exists()) {
					getLocalProperties().setValue(EarthProperty.METADATA_FILE, otherFile.getAbsolutePath());
				}
			}

		} catch (final Exception e) {
			logger.error("One of the definition files is not defined", e); //$NON-NLS-1$
		}

	}

	
	private int parseInt( String intNumber ){
		int i = 0;
		try{
			if( StringUtils.isNoneBlank( intNumber ) ) {
				i = Integer.parseInt( intNumber );
			}
		}catch(Exception e){
			logger.error( "Error parsing integer number" );
		}
		return i;
	}

	public KmlGenerator getKmlGenerator() {
		KmlGenerator generateKml =null;
		
		final String crsSystem = getLocalProperties().getCrs();
		final Integer innerPointSide = parseInt(getLocalProperties().getValue(EarthProperty.INNER_SUBPLOT_SIDE));
		final Integer largeCentralPlotSide = parseInt(getLocalProperties().getValue(EarthProperty.LARGE_CENTRAL_PLOT_SIDE));
		final String distanceToBuffers = getLocalProperties().getValue(EarthProperty.DISTANCE_TO_BUFFERS);
		SAMPLE_SHAPE plotShape = getLocalProperties().getSampleShape();
		final String hostAddress = ServerController.getHostAddress(getLocalProperties().getHost(), getLocalProperties().getPort());
		
		final float distanceBetweenSamplePoints, distanceToPlotBoundaries;
		String dBSP = getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS);
		try {
			distanceBetweenSamplePoints = Float.parseFloat(dBSP);
		} catch (Exception e) {
			logger.error("Error parsing distance between sample points , wrong value : " + dBSP,e);
			EarthApp.showMessage("Attention: Check earth.properties file. The distance between sample points must be a number! You have set it to : " + dBSP); //$NON-NLS-1$
			return null;
		}

		
		String dToPlotB = getLocalProperties().getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES);
		try {
			distanceToPlotBoundaries = Float.parseFloat(dToPlotB);
		} catch (Exception e) {
			logger.error("Error parsing distance between plots , wrong value : " + dToPlotB,e);
			EarthApp.showMessage("Attention: Check earth.properties file. The distance between sample point and border of the plot must be a number ! You have set it to : " + dToPlotB); //$NON-NLS-1$
			return null;
		}		
		final String localPort = getLocalProperties().getLocalPort();
		final String numberOfSamplingPlots = getLocalProperties().getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT);
		final String csvFile = getLocalProperties().getCsvFile();
		
		int numberOfPoints = 25;
		if ((numberOfSamplingPlots != null) && (numberOfSamplingPlots.trim().length() > 0)) {
			numberOfPoints = parseInt(numberOfSamplingPlots.trim());
		}

		try{ 
			// If there is a polygon column then the type of plot shape is assumed to be POLYGON
			if( csvContainsPolygons(csvFile)){
				plotShape = SAMPLE_SHAPE.POLYGON;
			}
						
			if (plotShape.equals(SAMPLE_SHAPE.CIRCLE)) {
				generateKml = new CircleKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide,  numberOfPoints, distanceBetweenSamplePoints );
			} else if (plotShape.equals(SAMPLE_SHAPE.NFMA)) {
				generateKml = new NfmaKmlGenerator(crsSystem, hostAddress, localPort, 150, false);
			} else if (plotShape.equals(SAMPLE_SHAPE.NFMA_250)) {
				generateKml = new NfmaKmlGenerator(crsSystem, hostAddress, localPort, 250, true);
			} else if (plotShape.equals(SAMPLE_SHAPE.NFI_CIRCLES)) {
				
				String dBP = getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_PLOTS );
				float distanceBetweenPlots;
				try {
					distanceBetweenPlots = Float.parseFloat(dBP);
				} catch (Exception e) {
					logger.error("Error parsing distance between plots , wrong value : " + dBP,e);
					EarthApp.showMessage("Attention: Check earth.properties file. The distance between plots must be a number! You have set it to : " + dBP); //$NON-NLS-1$
					return null;
				}	
				
				generateKml = new NfiCirclesKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide,  distanceBetweenSamplePoints, distanceBetweenPlots );
			}else if (plotShape.equals(SAMPLE_SHAPE.HEXAGON)) {
				generateKml = new HexagonKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide,  numberOfPoints, distanceBetweenSamplePoints );
			}  else if (plotShape.equals(SAMPLE_SHAPE.SQUARE_CIRCLE)) {
				generateKml = new SquareWithCirclesKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide,  numberOfPoints, 
						distanceBetweenSamplePoints, distanceToPlotBoundaries);
			} else if (plotShape.equals(SAMPLE_SHAPE.POLYGON)) {
				generateKml = new PolygonKmlGenerator(crsSystem, hostAddress, localPort);
			} else {
				generateKml = new SquareKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide,  numberOfPoints, 
						distanceBetweenSamplePoints, distanceToPlotBoundaries, largeCentralPlotSide, distanceToBuffers);
			}
		}catch(IOException e){
			logger.error("Error generating KML " + e );
		}
		return generateKml;
	}
	
	

	private boolean csvContainsPolygons(String csvFile) throws IOException {
		CSVReader csvReader = CsvReaderUtils.getCsvReader(csvFile);
		csvReader.readNext(); // Ignore it might be the column headers
		
		String[] secondLine = csvReader.readNext();
		if( secondLine != null && !CsvReaderUtils.onlyEmptyCells(secondLine) ){
			if( KmlGenerator.getKmlPolygonColumn(secondLine) != null ){
				return true;
			}
		}
		return false;
	}

	private void generateKml() throws KmlGenerationException, IOException {

		KmlGenerator kmlGenerator = null;
		kmlGenerator = getKmlGenerator();

		if ( kmlGenerator == null ){
			throw new KmlGenerationException("Error while generating KML");
		}

		final String csvFile = getLocalProperties().getCsvFile();
		String balloon = getLocalProperties().getBalloonFile();
		final String template = getLocalProperties().getTemplateFile();
		final String distanceBetweenSamplePoints = getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS);
		final String distancePlotBoundaries = getLocalProperties().getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES);

		// In case the user sets up the OPEN_BALLOON_IN_FIREFOX flag to
		// true. Meaning that a small ballon opens in the placemark which in
		// its turn
		// opens a firefox browser with the real form
		final Boolean openBalloonInFirefox = Boolean.valueOf(getLocalProperties().getValue(EarthProperty.OPEN_BALLOON_IN_BROWSER));
		if (openBalloonInFirefox) {
			String alternativeBalloon = getLocalProperties().getValue(EarthProperty.ALTERNATIVE_BALLOON_FOR_BROWSER);
			if( !StringUtils.isBlank( alternativeBalloon ) ){
				balloon = alternativeBalloon;
			}
		}

		// Using all of the files that compose the final KML it is generated and stores in KML_RESULTING_TEMP_FILE
		kmlGenerator.generateKmlFile(KML_RESULTING_TEMP_FILE, csvFile, balloon, template, distanceBetweenSamplePoints, distancePlotBoundaries, earthSurveyService.getCollectSurvey());
		updateFilesUsedChecksum();

	}

	private void updateFilesUsedChecksum() throws IOException {
		final String csvFile = getLocalProperties().getCsvFile();
		final String balloon = getLocalProperties().getBalloonFile();
		final String template = getLocalProperties().getTemplateFile();

		getLocalProperties().saveBalloonFileChecksum(CollectEarthUtils.getMd5FromFile(balloon));
		getLocalProperties().saveCsvFileCehcksum(CollectEarthUtils.getMd5FromFile(csvFile));
		getLocalProperties().saveTemplateFileChecksum(CollectEarthUtils.getMd5FromFile(template));
	}

	public void generateLoaderKmlFile() throws IOException, TemplateException {

		getLocalProperties().saveGeneratedOn(System.currentTimeMillis() + ""); //$NON-NLS-1$

		final Map<String, Object> data = new HashMap<String, Object>();
		data.put("host", ServerController.getHostAddress(getLocalProperties().getHost(), getLocalProperties().getLocalPort())); //$NON-NLS-1$
		data.put("kmlGeneratedOn", getLocalProperties().getGeneratedOn()); //$NON-NLS-1$
		data.put("surveyName", getLocalProperties().getValue(EarthProperty.SURVEY_NAME)); //$NON-NLS-1$
		data.put("plotFileName", KmlGenerator.getCsvFileName(getLocalProperties().getValue(EarthProperty.SAMPLE_FILE))); //$NON-NLS-1$

		FreemarkerTemplateUtils.applyTemplate(new File(KML_NETWORK_LINK_TEMPLATE), new File(KML_NETWORK_LINK_STARTER), data);
	}

	private boolean isKmlUpToDate() throws IOException {

		final String csvFile = getLocalProperties().getCsvFile();
		final String balloon = getLocalProperties().getBalloonFile();
		final String template = getLocalProperties().getTemplateFile();

		boolean upToDate = true;
		if (!getLocalProperties().getBalloonFileChecksum().trim().equals(CollectEarthUtils.getMd5FromFile(balloon))
				|| !getLocalProperties().getTemplateFileChecksum().trim().equals(CollectEarthUtils.getMd5FromFile(template))
				|| !getLocalProperties().getCsvFileChecksum().trim().equals(CollectEarthUtils.getMd5FromFile(csvFile))) {
			upToDate = false;
		}

		final File kmzFile = new File(KmlGeneratorService.KMZ_FILE_PATH);
		if (!kmzFile.exists()) {
			upToDate = false;
		}

		return upToDate;

	}
	
	public void generatePlacemarksKmzFile() throws IOException, KmlGenerationException {
		generatePlacemarksKmzFile(false);
	}

	public void generatePlacemarksKmzFile(boolean force_recreation ) throws IOException, KmlGenerationException {

		logger.info("START - Generate KMZ file"); //$NON-NLS-1$

		if (force_recreation || !isKmlUpToDate()) {

			generateKml();

			final KmzGenerator kmzGenerator = new KmzGenerator();

			final String balloon = getLocalProperties().getBalloonFile();
			final File balloonFile = new File(balloon);
			final String folderToInclude = balloonFile.getParent() + File.separator + EarthConstants.FOLDER_COPIED_TO_KMZ;

			kmzGenerator.generateKmzFile(KMZ_FILE_PATH, KML_RESULTING_TEMP_FILE, folderToInclude);
			logger.info("KMZ File generated : " + KMZ_FILE_PATH); //$NON-NLS-1$

			copyContentsToGeneratedFolder(folderToInclude);

			final File kmlFile = new File(KML_RESULTING_TEMP_FILE);
			if (kmlFile.exists()) {
				final boolean deleted = kmlFile.delete();
				if (deleted) {
					logger.info("KML File deleted : " + KML_RESULTING_TEMP_FILE); //$NON-NLS-1$
				} else {
					throw new IOException("The KML file could not be deleted at " + kmlFile.getPath()); //$NON-NLS-1$
				}
			}

		}
		logger.info("END - Generate KMZ file"); //$NON-NLS-1$
	}
}

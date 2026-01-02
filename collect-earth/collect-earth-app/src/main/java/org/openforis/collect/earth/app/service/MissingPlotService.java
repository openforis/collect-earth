package org.openforis.collect.earth.app.service;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Set;
import java.util.StringJoiner;

import org.apache.commons.lang3.ArrayUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.view.InfiniteProgressMonitor;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.model.RecordFilter;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.model.BooleanAttribute;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import com.opencsv.CSVReader;
import com.opencsv.exceptions.CsvValidationException;

@Component
public class MissingPlotService {

	@Autowired
	private RecordManager recordManager;

	@Autowired
	private EarthSurveyService earthSurveyService;

	private final Logger logger = LoggerFactory.getLogger(MissingPlotService.class);

	public File getMissingPlotFile(Map<String, List<String[]>> missingPlotData) {

		File tempFile = null;
		try {
			tempFile = File.createTempFile("missingPlots",  ".csv");
			tempFile.deleteOnExit();

			try( BufferedWriter fw = new BufferedWriter(new OutputStreamWriter(  new FileOutputStream( tempFile ), StandardCharsets.UTF_8 ) ) ){
				Set<String> files = missingPlotData.keySet();
				for (String plotFile : files) {
					List<String[]> missingPlots = missingPlotData.get(plotFile);
					for (String[] plotData : missingPlots) {
						StringJoiner csvRow = new StringJoiner(",");
						for (String data : plotData) {
							// Use replace() instead of replaceAll() for literal string replacement
							data = data.replace("\"", "\\\"");
							csvRow.add("\"" + data + "\"");
						}
						fw.write(csvRow.toString());
						fw.write("\n");
					}
				}
			}

		} catch (IOException e) {
			logger.error("Error while producing the CSV with the missing plots" );
		}

		return tempFile;
	}
	public String getMissingPlotInformation(Map<String, List<String[]>> allPlotDataInFiles, Map<String, List<String[]>> missingPlotDataPerFile ) {

		String missingPlotsText = getTextMissingPlots( missingPlotDataPerFile );

		int totalPlots = 0;
		int missingPlots = 0;
		for (Entry<String, List<String[]>> entry : allPlotDataInFiles.entrySet() ) {
			if( entry.getValue()!=null){
				totalPlots += entry.getValue().size();
				missingPlots += missingPlotDataPerFile.get( entry.getKey() ).size();
			}
		}
		missingPlotsText += "\n\n"+Messages.getString("MissingPlotsListener.10") + totalPlots ; //$NON-NLS-1$ //$NON-NLS-2$

		if( missingPlots > 0 ){
			missingPlotsText += "\n"+Messages.getString("MissingPlotsListener.12") + missingPlots; //$NON-NLS-1$ //$NON-NLS-2$
		}else{
			missingPlotsText +="\n"+Messages.getString("MissingPlotsListener.14"); //$NON-NLS-1$ //$NON-NLS-2$
		}
		return missingPlotsText;
	}

	private String getTextMissingPlots(Map<String, List<String[]>> missingPlotDataPerFile) {
		StringBuilder missingPlots = new StringBuilder();

		Set<String> files = missingPlotDataPerFile.keySet();
		for (String fileToBeChecked : files) {
			missingPlots.append("\n").append(Messages.getString("MissingPlotsListener.5")).append(fileToBeChecked).append(" : \n"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$

			List<String[]> missingIds = missingPlotDataPerFile.get(fileToBeChecked);
			if (missingIds.isEmpty()) {
				missingPlots.append("COMPLETE "); //$NON-NLS-1$
			} else {
				StringJoiner idJoiner = new StringJoiner(",");
				for (String[] missingPlotData : missingIds) {
					idJoiner.add(missingPlotData[0]);
				}
				missingPlots.append(idJoiner.toString());
			}
			missingPlots.append("\n"); //$NON-NLS-1$
		}
		return missingPlots.toString();
	}

	private CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		CSVReader reader;
		final BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), StandardCharsets.UTF_8)); //$NON-NLS-1$
		reader = new CSVReader(bufferedReader);
		return reader;
	}


	private List<String[]> getPlotDataFromFile(String plotCoordinateFile) {
		final List<String[]> plotData = new ArrayList<>();
		try {
			final CSVReader plotCsvReader = getCsvReader(plotCoordinateFile);
			String[] csvRow;
			while ((csvRow = plotCsvReader.readNext()) != null) {
				plotData.add(csvRow);
			}
		} catch (final FileNotFoundException e) {
			logger.error("Error reading coordinate file " + plotCoordinateFile, e); //$NON-NLS-1$
		} catch (final IOException e) {
			logger.error("Error reading CSV line", e); //$NON-NLS-1$
		} catch (CsvValidationException e) {
			logger.error("Error reading coordinate file " + plotCoordinateFile, e); //$NON-NLS-1$
		}
		return plotData;
	}

	private String[] getKeys(String[] plotData ) {
		List<AttributeDefinition> keyAttributeDefinitions = earthSurveyService.getCollectSurvey().getSchema().getRootEntityDefinitions().get(0)
				.getKeyAttributeDefinitions();
		int numberOfKeys = keyAttributeDefinitions.size();
		return ArrayUtils.subarray(plotData, 0, numberOfKeys);
	}

	public Map<String, List<String[]>> getMissingPlotsByFile(Map<String, List<String[]>> plotDataByFIle, InfiniteProgressMonitor infiniteProgressMonitor) {
		final Map<String, List<String[]>> missingPlotIdsByFile = new HashMap<>();
		final Set<String> plotFiles = plotDataByFIle.keySet();
		int i = 0;
		for (final String plotFile : plotFiles) {

			infiniteProgressMonitor.updateProgress( ++i, plotFiles.size(), StringUtils.getFilename( StringUtils.cleanPath( plotFile ) ) );
			missingPlotIdsByFile.put(plotFile, new ArrayList<String[]>());

			final List<String[]> plotDataInFile = plotDataByFIle.get(plotFile);
			for (final String[] plotData : plotDataInFile) {

				String[] plotKeys = getKeys(plotData);
				// If the plot ID is not contained in the DB
				// And if the latitude cell (second column) actually contains a number (so it is not a header row)
				if (!isIdActivelySavedInDB(plotKeys) && isLatitudeANumber(plotData[ plotKeys.length ]) ) {
					missingPlotIdsByFile.get(plotFile).add(plotData);
				}
			}
		}
		return missingPlotIdsByFile;
	}

	private boolean isLatitudeANumber(String string) {
		try{
			Float.parseFloat(string);
			return true;
		}catch (Exception  e){
			return false;
		}
	}

	public Map<String, List<String[]>> getPlotDataByFile(File[] selectedPlotFiles) {
		final Map<String, List<String[]>> plotDataByFile = new HashMap<>();
		if( selectedPlotFiles != null && selectedPlotFiles.length > 0 ) {
			for (final File file : selectedPlotFiles) {
				plotDataByFile.put(file.getAbsolutePath(), getPlotDataFromFile(file.getAbsolutePath()));
			}
		}
		return plotDataByFile;
	}

	private boolean isIdActivelySavedInDB(String[] plotIds) {
		RecordFilter rf = new RecordFilter(earthSurveyService.getCollectSurvey(), EarthConstants.ROOT_ENTITY_NAME);
		rf.setKeyValues( Arrays.asList( plotIds ));
		final List<CollectRecordSummary> summaries = recordManager.loadSummaries(rf);

		if( summaries != null && summaries.size() == 1 ){
			CollectRecord record = recordManager.load(earthSurveyService.getCollectSurvey(), summaries.get(0).getId(), Step.ENTRY);
			BooleanAttribute node = null;
			try {
				node = record.findNodeByPath("/plot/"+ EarthConstants.ACTIVELY_SAVED_ATTRIBUTE_NAME); //$NON-NLS-1$
			} catch (Exception e) {
				logger.error("No actively_saved information found", e); //$NON-NLS-1$
			}
			return (node != null && !node.isEmpty() && node.getValue().getValue() );
		}else{
			return false;
		}
	}

}

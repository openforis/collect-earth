package org.openforis.collect.earth.app.ad_hoc;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.swing.JFrame;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.DataFormat;
import org.openforis.collect.earth.app.view.JFileChooserExistsAware;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.persistence.RecordPersistenceException;
import org.openforis.idm.model.TextAttribute;
import org.openforis.idm.model.TextValue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import au.com.bytecode.opencsv.CSVReader;

@Component
public final class FixMissingPlotsFileInfo {

	@Autowired
	private RecordManager recordManager;

	@Autowired
	private EarthSurveyService earthSurveyService;
	
	@Autowired
	private LocalPropertiesService localPropertiesService;

	private final Logger logger = LoggerFactory.getLogger(FixMissingPlotsFileInfo.class);

	private boolean stopFix = false;



	public void findMissingPlots(JFrame frame) {
		final File[] selectedPlotFiles = JFileChooserExistsAware.getFileChooserResults(DataFormat.COLLECT_COORDS, false, true, null,
				localPropertiesService, frame);
		
		final Map<String, List<String>> plotIdsByFile = getPlotIdsByFile(selectedPlotFiles);
	
		List<CollectRecord> plotIdsWithNoRegion = getPlotsNoRegion();
		
		for (CollectRecord record : plotIdsWithNoRegion) {
			String plotFile = getFileNameForId( plotIdsByFile, record );
			if( plotFile != null ){
				setPlotFile( record, plotFile );
			}else{
				System.out.println("No plot file found for plot with ID : " + getPlotId(record) );
				try {
					recordManager.delete( record.getId() );
				} catch (RecordPersistenceException e) {
					logger.error("Not able to remove plot with ID " + record.getId(), e ) ;
				}
			}
		}
	}

	private String getPlotId(CollectRecord record) {
		TextAttribute plot_id = (TextAttribute) record.findNodeByPath("/plot/id");
		return plot_id.getValue().getValue();
	}

	private List<CollectRecord> getAllRecords(){
		List<CollectRecord> records = recordManager.loadSummaries( earthSurveyService.getCollectSurvey() , EarthConstants.ROOT_ENTITY_NAME );
		return records;
	}
	
	private void setPlotFile(CollectRecord record, String plotFile) {
		
		TextValue textValue = new TextValue( plotFile );
		recordManager.addAttribute(record.getRootEntity(), "plot_file", textValue, null, null);
		
			recordManager.save( record );
			System.out.println("Setting record to plot_file : " + plotFile );
		
	}

	private String getFileNameForId(Map<String, List<String>> plotIdsByFile, CollectRecord record) {

		Set<String> fileNames = plotIdsByFile.keySet();
		String plotId = getPlotId(record);
		for (String filename : fileNames) {
			
			List<String> plotIds = plotIdsByFile.get(filename);
			for (String plotIdInFile : plotIds) {
				if( plotIdInFile.equals(plotId)){
					return filename;
				}
			}
		}		
		return null;
	}

	private List<CollectRecord> getPlotsNoRegion() {
		List<CollectRecord> plotsWithNoRegionInfo = new ArrayList<CollectRecord>();
		List<CollectRecord> allRecords = getAllRecords();
		for (CollectRecord summary : allRecords) {
			CollectRecord record = recordManager.load( earthSurveyService.getCollectSurvey(), summary.getId(), Step.ENTRY);
			TextAttribute plot_file = (TextAttribute) record.findNodeByPath("/plot/plot_file");
			if( plot_file ==null || plot_file.getValue() == null || plot_file.getValue().getValue() == null  ){
				plotsWithNoRegionInfo.add( record );
			}
		}
		System.out.println( "Number of plots with no plot_file info " + plotsWithNoRegionInfo.size() );
		return plotsWithNoRegionInfo;
	}

	private CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		CSVReader reader;
		final BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), Charset.forName("UTF-8"))); //$NON-NLS-1$
		reader = new CSVReader(bufferedReader, ',');
		return reader;
	}

	private List<String> getIdsInFile(String plotCoordinateFile) {
		final List<String> plotIds = new ArrayList<String>();
		try {
			final CSVReader plotCsvReader = getCsvReader(plotCoordinateFile);
			String[] csvRow;
			while ((csvRow = plotCsvReader.readNext()) != null) {
				plotIds.add(csvRow[0]);
			}
		} catch (final FileNotFoundException e) {
			logger.error("Error reading coordinate file " + plotCoordinateFile, e); //$NON-NLS-1$
		} catch (final IOException e) {
			logger.error("Error reading CSV line", e); //$NON-NLS-1$
		}

		return plotIds;
	}


	private Map<String, List<String>> getPlotIdsByFile(File[] selectedPlotFiles) {
		final Map<String, List<String>> plotIdsByFile = new HashMap<String, List<String>>();

		for (final File file : selectedPlotFiles) {
			if (shouldStopFixing()) {
				break;
			}
			plotIdsByFile.put(file.getName(), getIdsInFile(file.getAbsolutePath()));
		}

		return plotIdsByFile;
	}



	private boolean shouldStopFixing() {
		return stopFix;
	}

	public void stopFixing() {
		stopFix = true;

	}
}

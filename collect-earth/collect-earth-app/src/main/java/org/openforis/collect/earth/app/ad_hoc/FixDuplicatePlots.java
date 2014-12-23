package org.openforis.collect.earth.app.ad_hoc;

import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.idm.model.CoordinateAttribute;
import org.openforis.idm.model.TextAttribute;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class FixDuplicatePlots {

	@Autowired
	private RecordManager recordManager;

	@Autowired
	private EarthSurveyService earthSurveyService;

	private Logger logger = LoggerFactory.getLogger( FixCoordinates.class);

	private boolean stopFix = false;

	private List<CollectRecord> getAllRecords(){
		List<CollectRecord> records = recordManager.loadSummaries( earthSurveyService.getCollectSurvey() , EarthConstants.ROOT_ENTITY_NAME );
		return records;
	}



	public void fixHela(){
		List<CollectRecord> allRecords = getAllRecords();

		if( shouldStopFixing()){
			return;
		}
		int i = 0;
		for (CollectRecord summaryCollectRecord : allRecords) {
			if( shouldStopFixing()){
				break;
			}
			try {
				CollectRecord collectRecord = recordManager.load( earthSurveyService.getCollectSurvey(), summaryCollectRecord.getId(), Step.ENTRY);

				if( isSouthernPlot(collectRecord) ){
					recordManager.delete( collectRecord.getId() );
					i++;
					
				}

			} catch (Exception e) {
				logger.error("Error fixing Coordinates", e);
			}
		}
		System.out.println("In total fixed plots " + i);

	}

	private List<CollectRecord> getSouthernHighlandsRecords(List<CollectRecord> allRecords) {
		List<CollectRecord> southernHighlandsPlots = new ArrayList<CollectRecord>();

		for (CollectRecord record : allRecords) {
			if( record!= null ){
				CollectRecord collectRecord = recordManager.load( earthSurveyService.getCollectSurvey(), record.getId(), Step.ENTRY);
				TextAttribute plot_file = (TextAttribute) collectRecord.findNodeByPath("/plot/plot_file");
				if( plot_file !=null && plot_file.getValue().getValue().equals("southernHighlands.ced") ){
					southernHighlandsPlots.add( collectRecord );
				}
			}
		}
		return southernHighlandsPlots;
	}

	private CollectRecord findMathingCoordinatePlotInSouthern(List<CollectRecord> southernHighlandRecords, CoordinateAttribute plotCoord) {
		for (CollectRecord southernPlot : southernHighlandRecords) {
			
			CoordinateAttribute sothernCoord = (CoordinateAttribute) southernPlot.findNodeByPath("/plot/location");
			if( sothernCoord.getValue().equals(plotCoord.getValue() ) ){
				return southernPlot;
			}
		}
		return null;
	}

	private boolean isSouthernPlot(CollectRecord record) {
		
		TextAttribute plot_file = (TextAttribute) record.findNodeByPath("/plot/plot_file");
		return( plot_file!=null && plot_file.getValue().getValue().equals("southernHighlands.ced") );
	}

	private boolean shouldStopFixing() {
		return stopFix;
	}

	public void stopFixing() {
		stopFix  = true;

	}

}
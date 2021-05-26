package org.openforis.collect.earth.app.ad_hoc;

import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.model.RecordFilter;
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

	private List<CollectRecordSummary> getAllRecords(){
		return recordManager.loadSummaries(
				new RecordFilter(
						earthSurveyService.getCollectSurvey() ,
						EarthConstants.ROOT_ENTITY_NAME
				) );
	}



	public void fixHela(){
		List<CollectRecordSummary> allRecords = getAllRecords();

		if( shouldStopFixing()){
			return;
		}
		int i = 0;
		for (CollectRecordSummary summaryCollectRecord : allRecords) {
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
				logger.error("Error fixing Coordinates", e); //$NON-NLS-1$
			}
		}
		logger.info("In total fixed plots " + i); //$NON-NLS-1$

	}

	private List<CollectRecord> getSouthernHighlandsRecords(List<CollectRecord> allRecords) {
		List<CollectRecord> southernHighlandsPlots = new ArrayList<CollectRecord>();

		for (CollectRecord record : allRecords) {
			if( record!= null ){
				CollectRecord collectRecord = recordManager.load( earthSurveyService.getCollectSurvey(), record.getId(), Step.ENTRY);
				TextAttribute plot_file = (TextAttribute) collectRecord.getNodeByPath("/plot/plot_file"); //$NON-NLS-1$
				if( plot_file !=null && plot_file.getValue().getValue().equals("southernHighlands.ced") ){ //$NON-NLS-1$
					southernHighlandsPlots.add( collectRecord );
				}
			}
		}
		return southernHighlandsPlots;
	}

	private CollectRecord findMathingCoordinatePlotInSouthern(List<CollectRecord> southernHighlandRecords, CoordinateAttribute plotCoord) {
		for (CollectRecord southernPlot : southernHighlandRecords) {

			CoordinateAttribute sothernCoord = (CoordinateAttribute) southernPlot.getNodeByPath("/plot/location"); //$NON-NLS-1$
			if( sothernCoord.getValue().equals(plotCoord.getValue() ) ){
				return southernPlot;
			}
		}
		return null;
	}

	private boolean isSouthernPlot(CollectRecord record) {

		TextAttribute plot_file = (TextAttribute) record.getNodeByPath("/plot/plot_file"); //$NON-NLS-1$
		return( plot_file!=null && plot_file.getValue().getValue().equals("southernHighlands.ced") ); //$NON-NLS-1$
	}

	private boolean shouldStopFixing() {
		return stopFix;
	}

	public void stopFixing() {
		stopFix  = true;

	}

}
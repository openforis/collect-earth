package org.openforis.collect.earth.app.ad_hoc;

import java.util.List;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.model.RecordFilter;
import org.openforis.idm.model.Coordinate;
import org.openforis.idm.model.CoordinateAttribute;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public abstract class FixCoordinates {

	@Autowired
	private RecordManager recordManager;

	@Autowired
	private EarthSurveyService earthSurveyService;

	private Logger logger = LoggerFactory.getLogger( FixCoordinates.class);

	private boolean stopFix = false;

	private List<CollectRecordSummary> getAllRecords(){
		RecordFilter rf = new RecordFilter(earthSurveyService.getCollectSurvey() , EarthConstants.ROOT_ENTITY_NAME);
		List<CollectRecordSummary> records = recordManager.loadSummaries( rf );
		return records;
	}

	public void fixCoordinates(){
		List<CollectRecordSummary> allRecords = getAllRecords();
		
		if( shouldStopFixing()){
			return;
		}
		
		for (CollectRecordSummary summaryCollectRecord : allRecords) {
			if( shouldStopFixing()){
				break;
			}
			try {
				CollectRecord collectRecord = recordManager.load( earthSurveyService.getCollectSurvey(), summaryCollectRecord.getId(), Step.ENTRY);
				CoordinateAttribute plotCoord = (CoordinateAttribute) collectRecord.getNodeByPath("/plot/location"); //$NON-NLS-1$
				if( plotCoord != null && plotCoord.getValue() != null ){
					if( plotCoord.getValue().getX() < getLongitudeLimit() ){
						Coordinate coordinate = new Coordinate(plotCoord.getValue().getY(), plotCoord.getValue().getX(), plotCoord.getValue().getSrsId() );
						plotCoord.setValue( coordinate );
						recordManager.save( collectRecord );
					}
				}
			} catch (Exception e) {
				logger.error("Error fixing Coordinates", e); //$NON-NLS-1$
			}
		}

	}

	protected abstract int getLongitudeLimit();

	private boolean shouldStopFixing() {
		return stopFix;
	}

	public void stopFixing() {
		stopFix  = true;

	}

}
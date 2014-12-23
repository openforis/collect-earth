package org.openforis.collect.earth.app.ad_hoc;

import java.util.List;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.idm.model.Coordinate;
import org.openforis.idm.model.CoordinateAttribute;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public abstract class FixOtherLand {

	@Autowired
	private RecordManager recordManager;

	@Autowired
	private EarthSurveyService earthSurveyService;

	private Logger logger = LoggerFactory.getLogger( FixOtherLand.class);

	private boolean stopFix = false;

	private List<CollectRecord> getAllRecords(){
		List<CollectRecord> records = recordManager.loadSummaries( earthSurveyService.getCollectSurvey() , EarthConstants.ROOT_ENTITY_NAME );
		return records;
	}

	public void fixCoordinates(){
		List<CollectRecord> allRecords = getAllRecords();
		
		if( shouldStopFixing()){
			return;
		}
		
		for (CollectRecord summaryCollectRecord : allRecords) {
			if( shouldStopFixing()){
				break;
			}
			try {
				CollectRecord collectRecord = recordManager.load( earthSurveyService.getCollectSurvey(), summaryCollectRecord.getId(), Step.ENTRY);
				CoordinateAttribute plotCoord = (CoordinateAttribute) collectRecord.findNodeByPath("/plot/location");
				if( plotCoord != null && plotCoord.getValue() != null ){
					if( plotCoord.getValue().getX() < getLongitudeLimit() ){
						Coordinate coordinate = new Coordinate(plotCoord.getValue().getY(), plotCoord.getValue().getX(), plotCoord.getValue().getSrsId() );
						plotCoord.setValue( coordinate );
						recordManager.save( collectRecord );
						
					}


				}
			} catch (Exception e) {
				logger.error("Error fixing Coordinates", e);
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
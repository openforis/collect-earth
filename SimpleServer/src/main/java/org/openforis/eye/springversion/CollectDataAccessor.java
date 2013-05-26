package org.openforis.eye.springversion;

import java.util.Map;

import org.openforis.collect.persistence.RecordPersistenceException;
import org.openforis.eye.service.EyeSurveyService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;

public class CollectDataAccessor implements DataAccessor {

	@Autowired
	EyeSurveyService eyeSurveyService;

	private final Logger logger = LoggerFactory.getLogger(CollectDataAccessor.class);

	@Override
	public Map<String, String> getData(String placemarkId) {
		return eyeSurveyService.getPlacemark(placemarkId);

	}

	@Override
	public boolean saveData(Map<String, String> collectedData) {
		boolean success = false;
		try {
			eyeSurveyService.storePlacemark(collectedData, null);
			success = true;
		} catch (RecordPersistenceException e) {
			logger.error("Error while saving placemark data ", e);
		}
		return success;
	}


}

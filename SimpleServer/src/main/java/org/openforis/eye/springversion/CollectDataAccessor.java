package org.openforis.eye.springversion;

import java.util.Map;

import org.openforis.eye.service.EyeSurveyService;
import org.springframework.beans.factory.annotation.Autowired;

public class CollectDataAccessor implements DataAccessor {

	@Autowired
	EyeSurveyService eyeSurveyService;

	// private final Logger logger =
	// LoggerFactory.getLogger(CollectDataAccessor.class);

	@Override
	public Map<String, String> getData(String placemarkId) {
		return eyeSurveyService.getPlacemark(placemarkId);

	}

	@Override
	public boolean saveData(Map<String, String> collectedData) {
		return eyeSurveyService.storePlacemark(collectedData, null);
	}

}

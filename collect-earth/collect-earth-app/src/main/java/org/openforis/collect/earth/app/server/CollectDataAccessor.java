package org.openforis.collect.earth.app.server;

import java.util.Map;

import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.springframework.beans.factory.annotation.Autowired;

public class CollectDataAccessor implements DataAccessor {

	@Autowired
	private EarthSurveyService earthSurveyService;

	// private final Logger logger =
	// LoggerFactory.getLogger(CollectDataAccessor.class);

	@Override
	public Map<String, String> getData(String placemarkId) {
		return earthSurveyService.getPlacemark(placemarkId);

	}

	@Override
	public boolean saveData(Map<String, String> collectedData) {
		return earthSurveyService.storePlacemark(collectedData, null);
	}

}

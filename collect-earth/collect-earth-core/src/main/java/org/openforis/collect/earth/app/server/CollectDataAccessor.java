package org.openforis.collect.earth.app.server;

import java.util.Map;

import org.openforis.collect.earth.app.service.AbstractEarthSurveyService;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Class to get/set data for the given placemark using Collect API.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class CollectDataAccessor implements DataAccessor {

	@Autowired
	private AbstractEarthSurveyService earthSurveyService;

	@Deprecated
	@Override
	public Map<String, String> getData(String placemarkId) {
		return earthSurveyService.getPlacemark( new String[]{placemarkId},true);
	}

	@Deprecated
	@Override
	public boolean saveData(Map<String, String> collectedData) {
		return earthSurveyService.storePlacemarkOld(collectedData, null);
	}

	@Override
	public Map<String, String> getData(String[] multipleKeyAttributes) {
		return earthSurveyService.getPlacemark(multipleKeyAttributes,true);
	}

	@Override
	public PlacemarkLoadResult loadDataExpanded(
			String[] multipleKeyAttributes) {
		return earthSurveyService.loadPlacemarkExpanded(multipleKeyAttributes);
	}

	@Override
	public PlacemarkLoadResult updateData(String[] multipleKeyAttributes, Map<String, String> collectedData,
			boolean partialUpdate) {
		return earthSurveyService.updatePlacemarkData(multipleKeyAttributes, collectedData, null, partialUpdate);
	}
}

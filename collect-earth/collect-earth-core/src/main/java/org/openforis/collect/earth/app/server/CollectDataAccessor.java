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

	/**
	* @deprecated Used for the 2013/14 versions of the surveys!
	*/
	@Deprecated
	@Override
	public Map<String, String> getData(String placemarkId) {
		return earthSurveyService.getPlacemark( new String[]{placemarkId},true);
	}

	/**
	* @deprecated Used for the 2013/14 versions of the surveys!
	*/
	@Deprecated
	@Override
	public boolean saveData(Map<String, String> collectedData) {
		return earthSurveyService.storePlacemarkOld(collectedData);
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
	
	@Override
	public PlacemarkLoadResult addNewEntity(String [] keyAttributes, String entityName, Map<String, String> values) {
		return earthSurveyService.updatePlacemarkAddNewEntity(keyAttributes, entityName, values, null);
	}
	
	@Override
	public PlacemarkLoadResult deleteEntity(String [] keyAttributes, String entityName, Map<String, String> values) {
		return earthSurveyService.updatePlacemarkDeleteEntity(keyAttributes, entityName, values, null);
	}
}

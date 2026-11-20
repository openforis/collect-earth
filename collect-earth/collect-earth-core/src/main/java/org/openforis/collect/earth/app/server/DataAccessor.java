package org.openforis.collect.earth.app.server;

import java.util.Map;

import org.openforis.collect.earth.core.model.PlacemarkLoadResult;

/**
 * Methods for setting/getting the data for the placemarks.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public interface DataAccessor {

	public PlacemarkLoadResult loadDataExpanded(String[] multipleKeyAttributes);

	public PlacemarkLoadResult updateData(String[] multipleKeyAttributes, 
			Map<String, String> values, boolean partialUpdate);

	public PlacemarkLoadResult addNewEntity(String[] keyAttributes, String entityName, Map<String, String> values);
	
	public PlacemarkLoadResult deleteEntity(String[] keyAttributes, String entityName, Map<String, String> values);
}

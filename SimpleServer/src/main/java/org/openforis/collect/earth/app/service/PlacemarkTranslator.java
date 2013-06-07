package org.openforis.collect.earth.app.service;

import java.util.HashMap;
import java.util.Map;

import org.openforis.collect.earth.app.model.Placemark;

public class PlacemarkTranslator {

	public Placemark marshall(Map<String, String> placemarkProperties) {
		Placemark placemark = new Placemark();

		return placemark;
	}

	public Map<String, String> unmarshall(Placemark placemark) {
		Map<String, String> placemarkProperties = new HashMap<String, String>();

		return placemarkProperties;
	}
}

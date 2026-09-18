package org.openforis.collect.earth.sampler.processor;

import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.opengis.referencing.operation.TransformException;

public class NfiThreeCirclesGenerator extends NfiCirclesKmlGenerator {

	public NfiThreeCirclesGenerator(String epsgCode, String hostAddress, String localPort, Integer innerPointSide,
			float distanceBetweenSamplePoints, float distanceBetweenPlots) {
		super(epsgCode, hostAddress, localPort, innerPointSide, distanceBetweenSamplePoints, distanceBetweenPlots);
	}

	@Override
	protected String getKmlForTract(SimplePlacemarkObject placemark) throws TransformException {
		// Three circles : the fourth ( north-east ) one belongs to NfiFourCirclesGenerator
		return getKmlForTract(placemark, false);
	}

}

package org.openforis.collect.earth.sampler.processor;

import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.opengis.referencing.operation.TransformException;

public class NfiFourCirclesGenerator extends NfiCirclesKmlGenerator {

	public NfiFourCirclesGenerator(String epsgCode, String hostAddress, String localPort, Integer innerPointSide,
			float distanceBetweenSamplePoints, float distanceBetweenPlots) {
		super(epsgCode, hostAddress, localPort, innerPointSide, distanceBetweenSamplePoints, distanceBetweenPlots);
		// TODO Auto-generated constructor stub
	}

	@Override
	protected String getKmlForTract(SimplePlacemarkObject placemark) throws TransformException {
		return getKmlForTract(placemark, true);
	}

}

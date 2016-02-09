package org.openforis.collect.earth.sampler.processor;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;

public class PolygonKmlGenerator extends AbstractPolygonKmlGenerator{

	
	public PolygonKmlGenerator(String epsgCode, String hostAddress, String localPort) {
		super(epsgCode, hostAddress, localPort, 0, 0, 0,0);

	}


	@Override
	public void fillExternalLine(SimplePlacemarkObject placemark) throws TransformException, KmlGenerationException {
		// No need to do anything, the polygon is already defined within the placemark.kmlPolygon attribute
		// The kmlPolygo is then used directly in the freemarker template
		// Just check that the value is actually set!
		if( StringUtils.isBlank( placemark.getKmlPolygon() ) ){
			throw new KmlGenerationException("The placemark kmlPolygon attribute is empty! There needs to be a column where the <Polygon> value is specified");
		}
	}

	@Override
	public void fillSamplePoints(SimplePlacemarkObject placemark) throws TransformException {
		// No sample points when using polygons... at least not yet
	}


}

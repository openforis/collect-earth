package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;

public abstract class AbstractPolygonGeometryKmlGenerator extends AbstractPolygonKmlGenerator {

	private int columnWithPolygonString;

	public AbstractPolygonGeometryKmlGenerator(String epsgCode, String hostAddress, String localPort,
			Integer innerPointSide, Integer numberOfPoints, double distanceBetweenSamplePoints,
			double distancePlotBoundary, Integer largeCentralPlotSide, String distanceToBuffers) {
		super(epsgCode, hostAddress, localPort, innerPointSide, numberOfPoints, distanceBetweenSamplePoints,
				distancePlotBoundary, largeCentralPlotSide, distanceToBuffers);
	}

	@Override
	public void fillExternalLine(SimplePlacemarkObject placemark) throws TransformException, KmlGenerationException {
		// Parse the polygon already defined within the placemark.kmlPolygon attribute
		// The resulting object is then used directly in the freemarker template
		if (StringUtils.isBlank(placemark.getPolygon())) {
			throw new KmlGenerationException(
					"The placemark kmlPolygon attribute is empty! There needs to be a column where the <Polygon> value is specified");
		}

		placemark.setMultiShape(getPolygonsInMultiGeometry(placemark.getPolygon()));
	}

	@Override
	public void fillSamplePoints(SimplePlacemarkObject placemark) throws TransformException {
		placemark.setPoints(new ArrayList<SimplePlacemarkObject>());
	}

	@Override
	public int getColumnWithPolygonString() {
		return columnWithPolygonString;
	}

	public abstract List<List<SimpleCoordinate>> getPolygonsInMultiGeometry(String polygon);

	public void setColumnWithPolygonString(int columnWithPolygonString) {
		this.columnWithPolygonString = columnWithPolygonString;
	}

}
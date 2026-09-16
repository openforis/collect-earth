package org.openforis.collect.earth.sampler.processor;

import org.openforis.collect.earth.app.EarthConstants.BUFFER_SHAPE;

public class HexagonKmlGenerator extends CircleKmlGenerator{

	private static final int NUMBER_OF_VERTICES_IN_HEXAGON = 6;

	public HexagonKmlGenerator(String epsgCode, String hostAddress,
			String localPort, Integer innerPointSide, Integer numberOfPoints,
			double radius, String distanceToBuffers, BUFFER_SHAPE bufferShape) {
		super(epsgCode, hostAddress, localPort, innerPointSide, numberOfPoints, radius, distanceToBuffers, bufferShape);

	}

	@Override
	protected int getNumberOfExternalPoints() {
		return NUMBER_OF_VERTICES_IN_HEXAGON;
	}
}

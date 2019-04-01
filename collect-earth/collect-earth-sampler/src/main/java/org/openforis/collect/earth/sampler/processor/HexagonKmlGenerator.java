package org.openforis.collect.earth.sampler.processor;

public class HexagonKmlGenerator extends CircleKmlGenerator{

	private static final int NUMBER_OF_VERTICES_IN_HEXAGON = 6;

	public HexagonKmlGenerator(String epsgCode, String hostAddress,
			String localPort, Integer innerPointSide, Integer numberOfPoints,
			double radius) {
		super(epsgCode, hostAddress, localPort, innerPointSide, numberOfPoints, radius);
		
	}

	@Override
	protected int getNumberOfExternalPoints() {
		return NUMBER_OF_VERTICES_IN_HEXAGON;
	}
}

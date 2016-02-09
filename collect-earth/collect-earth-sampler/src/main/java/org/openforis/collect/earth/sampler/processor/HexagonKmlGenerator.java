package org.openforis.collect.earth.sampler.processor;

public class HexagonKmlGenerator extends CircleKmlGenerator{

	public HexagonKmlGenerator(String epsgCode, String hostAddress,
			String localPort, Integer innerPointSide, Integer numberOfPoints,
			double radius) {
		super(epsgCode, hostAddress, localPort, innerPointSide, numberOfPoints, radius);
		
	}

	protected int getNumberOfExternalPoints() {
		return 6;
	}
}

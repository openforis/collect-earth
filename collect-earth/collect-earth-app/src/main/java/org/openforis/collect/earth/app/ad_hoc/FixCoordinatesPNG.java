package org.openforis.collect.earth.app.ad_hoc;

import org.springframework.stereotype.Component;

@Component
public class FixCoordinatesPNG extends FixCoordinates {

	@Override
	protected int getLongitudeLimit() {
		return 5;
	}

}

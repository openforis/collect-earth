package org.openforis.collect.earth.app.ad_hoc;

import org.springframework.stereotype.Component;

@Component
public class FixCoordinatesMongolia extends FixCoordinates {

	@Override
	protected int getLongitudeLimit() {
		return 87;
	}

}

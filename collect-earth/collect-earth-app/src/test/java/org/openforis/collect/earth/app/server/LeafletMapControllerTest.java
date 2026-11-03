package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService.PlotStatus;

/** What {@link LeafletMapController} tells the plots map. */
public class LeafletMapControllerTest {

	@Test
	public void theStatusesAreNamedAsThePlotsMapNamesThem() {
		assertEquals("saved", LeafletMapController.statusName(PlotStatus.SUBMITTED));
		assertEquals("partial", LeafletMapController.statusName(PlotStatus.IN_PROGRESS));
		// a record with nothing answered, as opening a plot stored before, is not started
		assertEquals("empty", LeafletMapController.statusName(PlotStatus.NOT_STARTED));
	}
}

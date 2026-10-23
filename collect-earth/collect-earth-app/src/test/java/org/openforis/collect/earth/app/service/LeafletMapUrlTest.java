package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

public class LeafletMapUrlTest {

	private static final String BASE = "http://127.0.0.1:8028/earth/";

	@Test
	public void withoutAPlotTheMapOpensAsAtStartUp() {
		assertEquals(BASE + "map", BrowserService.leafletMapUrl(BASE, null));
		assertEquals(BASE + "map", BrowserService.leafletMapUrl(BASE, " "));
	}

	@Test
	public void thePlotIsInTheAddressEncoded() {
		// The ids of plots with several keys are joined with commas
		assertEquals(BASE + "map?plot=710%2C1", BrowserService.leafletMapUrl(BASE, "710,1"));
		assertEquals(BASE + "map?plot=a+b%26c%3Dd", BrowserService.leafletMapUrl(BASE, "a b&c=d"));
	}
}

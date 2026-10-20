package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.openforis.collect.earth.app.service.LocalPropertiesService.VIEWER_TYPE_GOOGLE_EARTH_PRO;
import static org.openforis.collect.earth.app.service.LocalPropertiesService.VIEWER_TYPE_GOOGLE_EARTH_WEB;
import static org.openforis.collect.earth.app.service.LocalPropertiesService.VIEWER_TYPE_PLOTS_MAP;
import static org.openforis.collect.earth.app.service.LocalPropertiesService.resolveViewerType;

import org.junit.jupiter.api.Test;

public class ViewerTypeResolutionTest {

	@Test
	public void explicitViewerTypeWinsOverLegacyFlags() {
		assertEquals(VIEWER_TYPE_GOOGLE_EARTH_PRO, resolveViewerType(VIEWER_TYPE_GOOGLE_EARTH_PRO, true, true));
		assertEquals(VIEWER_TYPE_PLOTS_MAP, resolveViewerType(VIEWER_TYPE_PLOTS_MAP, false, true));
		assertEquals(VIEWER_TYPE_GOOGLE_EARTH_WEB, resolveViewerType(VIEWER_TYPE_GOOGLE_EARTH_WEB, false, false));
	}

	@Test
	public void unsetViewerTypeDefaultsToGoogleEarthPro() {
		assertEquals(VIEWER_TYPE_GOOGLE_EARTH_PRO, resolveViewerType("", false, false));
		assertEquals(VIEWER_TYPE_GOOGLE_EARTH_PRO, resolveViewerType(null, false, false));
	}

	@Test
	public void unknownViewerTypeFallsBackToLegacyFlags() {
		assertEquals(VIEWER_TYPE_PLOTS_MAP, resolveViewerType("leaflet", true, false));
	}

	@Test
	public void legacyFlagsAreMigrated() {
		assertEquals(VIEWER_TYPE_PLOTS_MAP, resolveViewerType("", true, false));
		assertEquals(VIEWER_TYPE_GOOGLE_EARTH_WEB, resolveViewerType("", true, true));
		assertEquals(VIEWER_TYPE_GOOGLE_EARTH_WEB, resolveViewerType("", false, true));
	}
}

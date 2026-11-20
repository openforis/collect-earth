package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.EnumSet;
import java.util.Properties;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.imagery.ImageryBrowser;
import org.openforis.collect.earth.app.service.imagery.ImagerySource;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Earth Map and Collect Earth Explorer (the Earth Engine app) open only with an address: a user folder made without the
 * installer's earth.properties_initial has their switches on and earth_map_url / gee_app_url blank. Such a source has no
 * tab (so no button on the plots map) and loads nothing, as the extra map without its address.
 */
public class BlankImageryUrlTest {

	private final ImageryBrowser imageryBrowser = mock(ImageryBrowser.class);

	private BrowserService service(String... keysAndValues) {
		Properties properties = new Properties();
		for (int i = 0; i < keysAndValues.length; i += 2) {
			properties.setProperty(keysAndValues[i], keysAndValues[i + 1]);
		}
		CollectSurvey survey = new CollectSurveyContext().createSurvey();
		survey.setName("s");
		EarthSurveyService earthSurveyService = mock(EarthSurveyService.class);
		when(earthSurveyService.getCollectSurvey()).thenReturn(survey);
		BrowserService service = new BrowserService();
		ReflectionTestUtils.setField(service, "localPropertiesService", new LocalPropertiesService(properties));
		ReflectionTestUtils.setField(service, "earthSurveyService", earthSurveyService);
		ReflectionTestUtils.setField(service, "imageryBrowser", imageryBrowser);
		return service;
	}

	private static SimplePlacemarkObject plot() {
		SimplePlacemarkObject plot = new SimplePlacemarkObject(new String[] { "40.1", "-3.7" });
		plot.setPlacemarkId("101");
		plot.setVisiblePlacemarkId("101");
		return plot;
	}

	@Test
	public void switchedOnWithoutAddressTheyHaveNoTab() {
		BrowserService service = service("open_gee_app", "true", "gee_app_url", "", "open_earth_map", "true");
		assertEquals(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB), service.enabledImagerySources());
		// Spaces alone are no address either
		service = service("open_gee_app", "true", "gee_app_url", "  ", "open_earth_map", "true", "earth_map_url", " ");
		assertEquals(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB), service.enabledImagerySources());
	}

	@Test
	public void switchedOnWithAnAddressTheyHaveTheirTab() {
		BrowserService service = service("open_gee_app", "true", "gee_app_url", "https://explorer.collectearth.org/",
				"open_earth_map", "true", "earth_map_url", "https://earthmap.org");
		assertEquals(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.GEE_APP, ImagerySource.EARTH_MAP),
				service.enabledImagerySources());
	}

	@Test
	public void switchedOffWithAnAddressTheyHaveNoTab() {
		BrowserService service = service("open_gee_app", "false", "gee_app_url", "https://explorer.collectearth.org/",
				"earth_map_url", "https://earthmap.org");
		assertEquals(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB), service.enabledImagerySources());
	}

	@Test
	public void withoutAddressThePlotIsNotLoaded() {
		// PlotImageryService.loadInOtherSources calls them for the sources left out too: they check again
		BrowserService service = service("open_gee_app", "true", "open_earth_map", "true", "earth_map_url", "");
		service.openGEEAppURL(plot(), 1);
		service.openEarthMapURL(plot(), 1);
		verifyNoInteractions(imageryBrowser);
	}

	@Test
	public void withAnAddressThePlotIsLoadedInItsTab() {
		BrowserService service = service("open_gee_app", "true", "gee_app_url", "https://explorer.collectearth.org/",
				"open_earth_map", "true", "earth_map_url", "https://earthmap.org");
		service.openGEEAppURL(plot(), 1);
		service.openEarthMapURL(plot(), 2);
		verify(imageryBrowser, timeout(5000)).loadLatest(eq(ImagerySource.GEE_APP), eq(1L), any(Runnable.class));
		verify(imageryBrowser, timeout(5000)).loadLatest(eq(ImagerySource.EARTH_MAP), eq(2L), any(Runnable.class));
		assertTrue(service.enabledImagerySources().contains(ImagerySource.GEE_APP));
	}
}

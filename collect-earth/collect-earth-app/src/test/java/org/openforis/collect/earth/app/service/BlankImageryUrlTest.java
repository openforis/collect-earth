package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.EnumSet;
import java.util.Properties;
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.openforis.collect.earth.app.service.imagery.ImageryBrowser;
import org.openforis.collect.earth.app.service.imagery.ImagerySource;
import org.openforis.collect.earth.app.service.imagery.ImageryTab;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Earth Map and Collect Earth Explorer (the Earth Engine app) with a blank address: a user folder made without the
 * installer's earth.properties_initial has their switches on and earth_map_url / gee_app_url blank. They take the
 * installer's addresses ( LocalPropertiesService.DEFAULT_EARTH_MAP_URL / DEFAULT_GEE_APP_URL ) rather than loading
 * "?polygon=..." or "#geoJson=..." on every plot.
 */
public class BlankImageryUrlTest {

	private final ImageryBrowser imageryBrowser = mock(ImageryBrowser.class);
	private final ImageryTab tab = mock(ImageryTab.class);

	private BrowserService service(String... keysAndValues) {
		Properties properties = new Properties();
		for (int i = 0; i < keysAndValues.length; i += 2) {
			properties.setProperty(keysAndValues[i], keysAndValues[i + 1]);
		}
		CollectSurvey survey = new CollectSurveyContext().createSurvey();
		survey.setName("s");
		EarthSurveyService earthSurveyService = mock(EarthSurveyService.class);
		when(earthSurveyService.getCollectSurvey()).thenReturn(survey);
		// The load runs at once, in the one tab
		doAnswer(call -> {
			call.getArgument(2, Runnable.class).run();
			return null;
		}).when(imageryBrowser).loadLatest(any(), any(Long.class), any());
		when(imageryBrowser.tab(any())).thenReturn(tab);
		when(tab.load(any(), any(Boolean.class), any(), any())).thenReturn(true);
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

	/** The addresses the tab loaded, in order. */
	private String[] loaded(int times) {
		ArgumentCaptor<String> urls = ArgumentCaptor.forClass(String.class);
		verify(tab, times(times)).load(urls.capture(), eq(true), any(Duration.class),
				any(BooleanSupplier.class));
		return urls.getAllValues().toArray(new String[0]);
	}

	/** The address of the installer's settings file, as in AuxiliaryWindowUrlTest */
	private static String installerValue(String file, String key) throws IOException {
		Properties properties = new Properties();
		try (Reader in = Files.newBufferedReader(Paths.get("../collect-earth-installer/src/main/resources", file))) {
			properties.load(in);
		}
		return properties.getProperty(key);
	}

	@Test
	public void theDefaultsAreTheInstallersAddresses() throws IOException {
		for (String file : new String[] { "earth.properties_initial", "earth.properties_forced_update" }) {
			assertEquals(LocalPropertiesService.DEFAULT_EARTH_MAP_URL, installerValue(file, "earth_map_url"), file);
			assertEquals(LocalPropertiesService.DEFAULT_GEE_APP_URL, installerValue(file, "gee_app_url"), file);
		}
	}

	@Test
	public void aBlankOrMissingAddressIsTheDefault() {
		assertEquals(LocalPropertiesService.DEFAULT_GEE_APP_URL, new LocalPropertiesService(new Properties()).getGEEAppURL());
		assertEquals(LocalPropertiesService.DEFAULT_EARTH_MAP_URL, new LocalPropertiesService(new Properties()).getEarthMapURL());
		Properties blank = new Properties();
		blank.setProperty("gee_app_url", "  ");
		blank.setProperty("earth_map_url", "");
		assertEquals(LocalPropertiesService.DEFAULT_GEE_APP_URL, new LocalPropertiesService(blank).getGEEAppURL());
		assertEquals(LocalPropertiesService.DEFAULT_EARTH_MAP_URL, new LocalPropertiesService(blank).getEarthMapURL());
		// What the file says, unchanged in it
		assertEquals("", blank.getProperty("earth_map_url"));
	}

	@Test
	public void anAddressSetIsKept() {
		Properties set = new Properties();
		set.setProperty("gee_app_url", "https://ee-app.example.org/view");
		set.setProperty("earth_map_url", "https://earthmap.example.org");
		assertEquals("https://ee-app.example.org/view", new LocalPropertiesService(set).getGEEAppURL());
		assertEquals("https://earthmap.example.org", new LocalPropertiesService(set).getEarthMapURL());
	}

	@Test
	public void switchedOnWithoutAddressTheyHaveTheirTab() {
		BrowserService service = service("open_gee_app", "true", "gee_app_url", "", "open_earth_map", "true");
		assertEquals(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.GEE_APP, ImagerySource.EARTH_MAP),
				service.enabledImagerySources());
	}

	@Test
	public void withoutAddressThePlotGoesToTheDefaultOne() {
		BrowserService service = service("open_gee_app", "true", "gee_app_url", " ", "open_earth_map", "true");
		service.openGEEAppURL(plot(), 1);
		service.openEarthMapURL(plot(), 2);
		String[] urls = loaded(2);
		assertTrue(urls[0].startsWith("https://explorer.collectearth.org/#geoJson="), urls[0]);
		assertTrue(urls[1].startsWith("https://earthmap.org?polygon="), urls[1]);
	}

	@Test
	public void withAnAddressThePlotGoesToIt() {
		BrowserService service = service("open_gee_app", "true", "gee_app_url", "https://ee-app.example.org/view",
				"open_earth_map", "true", "earth_map_url", "https://earthmap.example.org");
		service.openGEEAppURL(plot(), 1);
		service.openEarthMapURL(plot(), 2);
		String[] urls = loaded(2);
		assertTrue(urls[0].startsWith("https://ee-app.example.org/view#geoJson="), urls[0]);
		assertTrue(urls[1].startsWith("https://earthmap.example.org?polygon="), urls[1]);
	}

	@Test
	public void switchedOffTheyHaveNoTabWhateverTheAddress() {
		BrowserService service = service("open_gee_app", "false", "gee_app_url", "", "open_earth_map", "false",
				"earth_map_url", "https://earthmap.org");
		assertEquals(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB), service.enabledImagerySources());
	}
}

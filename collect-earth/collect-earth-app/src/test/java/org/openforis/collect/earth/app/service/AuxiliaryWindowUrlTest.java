package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.Reader;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Map;
import java.util.Properties;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.metamodel.TextAttributeDefinition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Earth Map and the Earth Engine App are shown to the collector next to the plot, so they name it by its visible id: a
 * blind check copy "101,2" is "101" there too, like it is in the plots map and Google Earth Web.
 */
public class AuxiliaryWindowUrlTest {

	/** A survey with the keys id and round, round hidden from the collector when {@code hideRound}. */
	private static CollectSurvey survey(boolean hideRound) {
		CollectSurvey survey = new CollectSurveyContext().createSurvey();
		survey.setName("t21_round_check");
		Schema schema = survey.getSchema();
		EntityDefinition plot = schema.createEntityDefinition();
		plot.setName("plot");
		schema.addRootEntityDefinition(plot);
		TextAttributeDefinition id = schema.createTextAttributeDefinition();
		id.setName("id");
		id.setKey(true);
		plot.addChildDefinition(id);
		TextAttributeDefinition round = schema.createTextAttributeDefinition();
		round.setName("round");
		round.setKey(true);
		plot.addChildDefinition(round);
		survey.getAnnotations().setHideKeyInCollectEarthRecordList(round, hideRound);
		return survey;
	}

	private static SimplePlacemarkObject plot(String placemarkId) {
		SimplePlacemarkObject plot = new SimplePlacemarkObject(new String[] { "40.1", "-3.7" });
		plot.setPlacemarkId(placemarkId);
		plot.setShape(Arrays.asList(new SimpleCoordinate(40.1, -3.7), new SimpleCoordinate(40.2, -3.7),
				new SimpleCoordinate(40.2, -3.6), new SimpleCoordinate(40.1, -3.7)));
		return plot;
	}

	private static String decoded(String s) {
		return URLDecoder.decode(s, StandardCharsets.UTF_8);
	}

	/** The value of a parameter of the URL, split by {@code separator}, decoded. */
	private static String param(String url, String name, String separator) {
		for (String part : url.split(separator)) {
			if (part.startsWith(name + "=")) {
				return decoded(part.substring(name.length() + 1));
			}
		}
		return null;
	}

	@Test
	public void theVisibleIdOfACheckCopyHasNoRound() {
		assertEquals("101", BrowserService.visiblePlotIdOf(plot("101,2"), survey(true)));
		assertEquals("101,2", BrowserService.visiblePlotIdOf(plot("101,2"), survey(false)));
	}

	@Test
	public void theVisibleIdAlreadyGivenToThePlotIsUsed() {
		SimplePlacemarkObject plot = plot("101,2");
		plot.setVisiblePlacemarkId("101");
		assertEquals("101", BrowserService.visiblePlotIdOf(plot, null));
	}

	@Test
	public void aPlotWithoutIdHasAnEmptyVisibleId() {
		SimplePlacemarkObject plot = new SimplePlacemarkObject(new String[] { "40.1", "-3.7" });
		assertEquals("", BrowserService.visiblePlotIdOf(plot, survey(true)));
	}

	@Test
	public void earthMapNamesThePolygonByTheVisibleId() throws Exception {
		String url = BrowserService.earthMapUrl("https://earthmap.org/", plot("101,2"), "101", null, null, null);
		assertTrue(url.startsWith("https://earthmap.org/?polygon="), url);
		assertFalse(decoded(url).contains("101,2"), url);
		JsonNode polygon = new ObjectMapper().readTree(param(url.substring(url.indexOf('?') + 1), "polygon", "&"));
		assertEquals("Feature", polygon.get("type").asText());
		assertEquals("101", polygon.get("properties").get("name").asText());
		assertEquals("Polygon", polygon.get("geometry").get("type").asText());
		assertEquals(-3.7, polygon.get("geometry").get("coordinates").get(0).get(0).get(0).asDouble());
		assertTrue(url.endsWith("&aoi=global&embed=true"), url);
	}

	@Test
	public void earthMapKeepsItsLayersScriptsAndArea() {
		String url = BrowserService.earthMapUrl("https://earthmap.org/", plot("101,2"), "101", "a,b", "s", "ESP");
		String query = url.substring(url.indexOf('?') + 1);
		assertEquals("a,b", param(query, "layers", "&"));
		assertEquals("s", param(query, "scripts", "&"));
		assertEquals("ESP", param(query, "aoi", "&"));
	}

	@Test
	public void aVisibleIdWithAQuoteKeepsThePolygonValidJson() throws Exception {
		String url = BrowserService.earthMapUrl("https://earthmap.org/", plot("a\"b\\c"), "a\"b\\c", null, null, null);
		JsonNode polygon = new ObjectMapper().readTree(param(url.substring(url.indexOf('?') + 1), "polygon", "&"));
		assertEquals("a\"b\\c", polygon.get("properties").get("name").asText());
	}

	@Test
	public void theEarthEngineAppGetsTheVisibleId() {
		String url = BrowserService.geeAppUrl("https://app/view/plot", plot("101,2"), "101", "t21_round_check", null, "", null, null);
		String fragment = url.substring(url.indexOf('#') + 1);
		assertEquals("101", param(fragment, "plotId", ";"));
		assertEquals("t21_round_check", param(fragment, "survey", ";"));
		assertTrue(param(fragment, "geoJson", ";").startsWith("{\"type\":\"MultiLineString\""), url);
		assertFalse(decoded(url).contains("101,2"), url);
		assertFalse(url.contains("startTime"), url);
		assertFalse(url.contains("endTime"), url);
	}

	@Test
	public void theEarthEngineAppKeepsItsDates() {
		String url = BrowserService.geeAppUrl("https://app/view/plot", plot("101,2"), "101", "s", "2020-01-01",
				"2024-12-31", " ", null);
		assertTrue(url.endsWith("startTime=2020-01-01;endTime=2024-12-31;"), url);
	}

	/** Decodes as the Explorer does (decodeURIComponent): a plus sign stays a plus sign */
	private static String decodedAsTheExplorer(String s) {
		return URLDecoder.decode(s.replace("+", "%2B"), StandardCharsets.UTF_8);
	}

	@Test
	public void theExplorerGetsTheConfigurationLastWithSpacesAsPercent20() {
		String config = "{\"v\":1,\"layers\":[{\"type\":\"sentinel2\",\"params\":{\"label\":\"Dry season; ç\"}}],"
				+ "\"charts\":[{\"type\":\"index\",\"params\":{\"formula\":\"(nir - red) / (nir + red)\"}}]}";
		String url = BrowserService.geeAppUrl("https://app/view/plot", plot("101,2"), "101", "s", "2020-01-01", "2024-12-31",
				" " + config + " ", null);
		assertTrue(url.contains(";endTime=2024-12-31;config="), url);
		assertTrue(url.endsWith(";"), url);
		String value = url.substring(url.indexOf(";config=") + ";config=".length(), url.length() - 1);
		assertFalse(value.contains("+") || value.contains(" ") || value.contains(";"), value);
		assertEquals(config, decoded(value));
		assertEquals(config, decodedAsTheExplorer(value));
	}

	/** The Earth Engine window's address in a new installation and after an update ( see LocalPropertiesService ) */
	private static String defaultAddress(String file) throws IOException {
		Properties properties = new Properties();
		try (Reader in = Files.newBufferedReader(Paths.get("../collect-earth-installer/src/main/resources", file))) {
			properties.load(in);
		}
		return properties.getProperty("gee_app_url");
	}

	@Test
	public void theDefaultAddressIsTheExplorerWithThePlotInTheFragment() throws IOException {
		String base = defaultAddress("earth.properties_initial");
		assertEquals("https://explorer.collectearth.org/", base);
		assertEquals(base, defaultAddress("earth.properties_forced_update"));
		String url = BrowserService.geeAppUrl(base, plot("7 a+b"), "7 a+b", "dry forest", "2020-01-01", "2024-12-31", "{\"v\":1}", null);
		assertTrue(url.startsWith("https://explorer.collectearth.org/#geoJson="), url);
		assertTrue(url.matches("[^;]*#geoJson=[^;]+;plotId=[^;]+;survey=[^;]+;startTime=2020-01-01;endTime=2024-12-31;config=[^;]+;"), url);
		String fragment = url.substring(url.indexOf('#') + 1);
		// Read as the Explorer reads it: segments split by ";", each value through decodeURIComponent
		for (String part : fragment.split(";")) {
			String value = decodedAsTheExplorer(part.substring(part.indexOf('=') + 1));
			if (part.startsWith("plotId=")) {
				assertEquals("7 a+b", value);
			} else if (part.startsWith("survey=")) {
				assertEquals("dry forest", value);
			} else if (part.startsWith("geoJson=")) {
				assertTrue(value.startsWith("{\"type\":\"MultiLineString\""), value);
			}
		}
	}

	@Test
	public void noConfigurationAddsNoPair() {
		assertFalse(BrowserService.geeAppUrl("https://app/view/plot", plot("101,2"), "101", "s", null, null, null, null).contains("config="));
		assertFalse(BrowserService.geeAppUrl("https://app/view/plot", plot("101,2"), "101", "s", null, null, "  ", null).contains("config="));
	}

	@Test
	public void theExplorerGetsTheNextPlotsOutlineLikeTheCurrentOne() {
		SimplePlacemarkObject next = plot("102");
		next.setShape(Arrays.asList(new SimpleCoordinate(41.1, -4.7), new SimpleCoordinate(41.2, -4.7),
				new SimpleCoordinate(41.2, -4.6), new SimpleCoordinate(41.1, -4.7)));
		String url = BrowserService.geeAppUrl("https://explorer.collectearth.org/", plot("101"), "101", "s", "2020-01-01",
				"2024-12-31", "{\"v\":1}", next);
		assertTrue(url.matches("[^;]*#geoJson=[^;]+;plotId=101;survey=s;startTime=2020-01-01;endTime=2024-12-31;next=[^;]+;config=[^;]+;"), url);
		String nextValue = url.substring(url.indexOf(";next=") + ";next=".length()).split(";")[0];
		assertFalse(nextValue.contains("+") || nextValue.contains(" "), nextValue);
		String nextGeoJson = decodedAsTheExplorer(nextValue);
		assertTrue(nextGeoJson.startsWith("{\"type\":\"MultiLineString\""), nextGeoJson);
		assertTrue(nextGeoJson.contains("-4.7"), nextGeoJson);
		// The very value geoJson has when that plot is the one opened
		String opened = BrowserService.geeAppUrl("https://explorer.collectearth.org/", next, "102", "s", null, null, null, null);
		assertEquals(param(opened.substring(opened.indexOf('#') + 1), "geoJson", ";"), nextGeoJson);
	}

	@Test
	public void noNextPlotAddsNoPair() {
		assertFalse(BrowserService.geeAppUrl("https://app/view/plot", plot("101"), "101", "s", null, null, null, null).contains("next="));
	}

	@Test
	public void theNextPlotIsTheOneAfterInThePlotFile() throws IOException {
		PlotFileIndex.PlotIndex index = new PlotFileIndex.PlotIndex("plots.csv", "1:1", "", null, null,
				Arrays.asList("a", "b", "c"), Arrays.asList(null, null, null),
				Arrays.asList(new double[] { 0, 0 }, new double[] { 0, 1 }, new double[] { 0, 2 }),
				Arrays.asList(new String[] { "a" }, new String[] { "b" }, new String[] { "c" }),
				Map.of("a", 0, "b", 1, "c", 2), new ObjectMapper());
		assertEquals(1, index.nextOf("a"));
		assertEquals(2, index.nextOf("b"));
		assertNull(index.nextOf("c"), "the last plot has none");
		assertNull(index.nextOf("z"), "a plot not in the plot file has none");
		assertNull(index.nextOf(null));
	}
}

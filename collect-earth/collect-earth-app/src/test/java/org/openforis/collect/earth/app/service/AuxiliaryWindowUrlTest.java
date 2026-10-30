package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

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
		String url = BrowserService.geeAppUrl("https://app/view/plot", plot("101,2"), "101", "t21_round_check", null, "");
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
				"2024-12-31");
		assertTrue(url.endsWith("startTime=2020-01-01;endTime=2024-12-31;"), url);
	}
}

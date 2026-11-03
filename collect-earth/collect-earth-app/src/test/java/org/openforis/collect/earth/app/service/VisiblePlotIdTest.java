package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.StringWriter;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.metamodel.SpatialReferenceSystem;
import org.openforis.idm.metamodel.TextAttributeDefinition;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import freemarker.template.Configuration;

/**
 * A survey whose round key is hidden from the record list ( collectearth:hideinrecordlist ) makes blind quality checks:
 * the collector must see a check copy "105,2" as "105", like a main plot "101,1" is seen as "101". The plots map, its
 * GeoJSON and the Google Earth Web outline name the plots by this visible id, and keep the whole id for everything else.
 */
public class VisiblePlotIdTest {

	/** A survey with the keys id and round, round hidden from the collector when {@code hideRound}. */
	private static CollectSurvey survey(boolean hideRound) {
		CollectSurvey survey = new CollectSurveyContext().createSurvey();
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
		survey.addSpatialReferenceSystem(new SpatialReferenceSystem(SpatialReferenceSystem.LAT_LON_SRS));
		return survey;
	}

	/** Only getPlotObject is used: no plot shapes, no templates. */
	private static KmlGenerator generator() {
		return new KmlGenerator("EPSG:4326") {
			@Override
			public void fillExternalLine(SimplePlacemarkObject placemark) {
			}

			@Override
			public void fillSamplePoints(SimplePlacemarkObject placemark) {
			}

			@Override
			protected Map<String, Object> getTemplateData(String csvFile, CollectSurvey collectSurvey, boolean kmlExport) {
				return Collections.emptyMap();
			}
		};
	}

	@Test
	public void thePlotOfARowIsNamedWithoutTheHiddenKeys() throws Exception {
		String[] header = { "id", "round", "YCoordinate", "XCoordinate" };
		SimplePlacemarkObject check = generator().getPlotObject(new String[] { "105", "2", "40.1", "-3.7" }, header,
				survey(true), false);
		assertEquals("105,2", check.getPlacemarkId());
		assertEquals("105", check.getVisiblePlacemarkId());

		SimplePlacemarkObject open = generator().getPlotObject(new String[] { "105", "2", "40.1", "-3.7" }, header,
				survey(false), false);
		assertEquals("105,2", open.getVisiblePlacemarkId());
	}

	@Test
	public void theVisibleIdOfAWholeId() {
		assertEquals("105", KmlGenerator.getVisiblePlacemarkIdOf("105,2", survey(true)));
		assertEquals("105,2", KmlGenerator.getVisiblePlacemarkIdOf("105,2", survey(false)));
		assertEquals("105", KmlGenerator.getVisiblePlacemarkId(new String[] { "105", "2", "40.1" }, survey(true)));
		assertNull(KmlGenerator.getVisiblePlacemarkIdOf(null, survey(true)));
		// An id that does not split into the keys: never shown when a key is hidden, as it is when none is
		assertEquals("", KmlGenerator.getVisiblePlacemarkIdOf("10,5,2", survey(true)));
		assertEquals("10,5,2", KmlGenerator.getVisiblePlacemarkIdOf("10,5,2", survey(false)));
	}

	@Test
	public void theGeoJsonGivesTheVisibleIdBesideTheWholeOne() throws Exception {
		SimplePlacemarkObject plot = new SimplePlacemarkObject();
		plot.setPlacemarkId("105,2");
		plot.setVisiblePlacemarkId("105");
		plot.setCoord(new SimpleCoordinate("40.1", "-3.7"));
		SimpleCoordinate a = new SimpleCoordinate("40.099", "-3.701");
		SimpleCoordinate b = new SimpleCoordinate("40.099", "-3.699");
		SimpleCoordinate c = new SimpleCoordinate("40.101", "-3.699");
		plot.setMultiShape(Collections.singletonList(Arrays.asList(a, b, c, a)));
		Map<String, String> values = new LinkedHashMap<>();
		values.put("id", "105");
		values.put("round", "2");
		plot.setValuesByColumn(values);

		JsonNode props = new ObjectMapper().readTree(new PlotGeoJsonBuilder().toFeature(plot)).get("properties");
		assertEquals("105,2", props.get("id").asText());
		assertEquals("105", props.get("visibleId").asText());
		// Still there for the balloon form ( $[EXTRA_round] ), which the map never shows
		assertEquals("2", props.get("round").asText());
	}

	@Test
	public void aPlotWithoutAVisibleIdIsNamedByItsId() throws Exception {
		SimplePlacemarkObject plot = new SimplePlacemarkObject();
		plot.setPlacemarkId("p1");
		JsonNode props = new ObjectMapper().readTree(new PlotGeoJsonBuilder().toFeature(plot)).get("properties");
		assertEquals("p1", props.get("visibleId").asText());

		assertEquals("p1", GoogleEarthWebService.plotLabel(plot));
		plot.setVisiblePlacemarkId("p");
		assertEquals("p", GoogleEarthWebService.plotLabel(plot));
		assertEquals("", GoogleEarthWebService.plotLabel(new SimplePlacemarkObject()));
	}

	@Test
	public void theGoogleEarthWebOutlineIsNamedByTheVisibleId() throws Exception {
		Configuration cfg = new Configuration(Configuration.VERSION_2_3_32);
		cfg.setDirectoryForTemplateLoading(new File("."));
		Map<String, Object> data = new LinkedHashMap<>();
		data.put("placemark", Collections.emptyMap());
		data.put("plotId", "105,2");
		data.put("plotLabel", "105");
		data.put("plotUrl", "https://earth.google.com/web/@1,1,0a,500d,35y,0h,0t,0r");
		data.put("inPageNavigation", "null");
		data.put("flightUrl", "");
		data.put("labels", Collections.singletonMap("plot", "Plot"));
		data.put("neighboursJson", "[]");
		StringWriter out = new StringWriter();
		cfg.getTemplate("resources/javascript_google_earth_web.fmt").process(data, out);
		String script = out.toString();
		assertTrue(script.contains("var PLOT_LABEL = \"105\";"), "the label is given to the script");
		assertTrue(script.contains("LABELS.plot + \" \" + PLOT_LABEL"), "the outline's title names the plot by its label");
		assertFalse(script.contains("LABELS.plot + \" \" + PLOT_ID"), "the whole id is not shown");
	}
}

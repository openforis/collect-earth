package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.MessageFormat;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.utils.GeoUtils;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.openforis.collect.earth.sampler.utils.NotWgs84Exception;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.metamodel.SpatialReferenceSystem;
import org.openforis.idm.metamodel.TextAttributeDefinition;

/**
 * Collect Earth takes only plots in WGS84 latitude and longitude, in decimal degrees (EPSG:4326), and converts none from
 * another system. A survey in another system (EPSG:32737, UTM 37S) used to fail on every plot with GeoTools'
 * NoSuchAuthorityCodeException, as its EPSG database is not shipped: it now opens and says, once, what to do; plots out
 * of the range of degrees (UTM metres) are left out and named.
 */
public class Wgs84OnlyTest {

	private static final String UTM_37S = "EPSG:32737";

	@TempDir
	Path folder;

	/** A survey keyed by the plot id, whose plots are in the coordinate system given (none when null). */
	private static CollectSurvey survey(String srsId) {
		CollectSurvey survey = new CollectSurveyContext().createSurvey();
		Schema schema = survey.getSchema();
		EntityDefinition plot = schema.createEntityDefinition();
		plot.setName("plot");
		schema.addRootEntityDefinition(plot);
		TextAttributeDefinition id = schema.createTextAttributeDefinition();
		id.setName("id");
		id.setKey(true);
		plot.addChildDefinition(id);
		if (srsId != null) {
			survey.addSpatialReferenceSystem(new SpatialReferenceSystem(srsId, null));
		}
		return survey;
	}

	/** Only getPlotObject is used: no plot shapes, no templates. */
	private static KmlGenerator generator() {
		return new KmlGenerator(UTM_37S) { // the project's old coordinates_reference_system setting, not used
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

	private static final String[] HEADER = { "id", "YCoordinate", "XCoordinate" };

	// ---------- the WGS84 check ----------

	@Test
	public void theNamesOfWgs84() {
		for (String wgs84 : new String[] { null, "", "  ", "LATLONG", "latlong", " LatLong ", "WGS84", "wgs84", " WGS84\t",
				"EPSG:4326", "epsg:4326", " EPSG:4326 " }) {
			assertTrue(GeoUtils.isUsingWGS84(wgs84), "[" + wgs84 + "]");
		}
		for (String other : new String[] { UTM_37S, "EPSG:3857", "EPSG:43260", "EPSG:4326x", "UTM", "WGS 84 / UTM zone 37S", "4326" }) {
			assertFalse(GeoUtils.isUsingWGS84(other), other);
		}
	}

	@Test
	public void theSurveysSystemIsItsFirstOneAndNoneIsWgs84() {
		assertEquals("", GeoUtils.getSurveySrsId(null));
		assertEquals("", GeoUtils.getSurveySrsId(survey(null)));
		assertTrue(GeoUtils.isUsingWGS84(survey(null)));
		assertEquals(UTM_37S, GeoUtils.getSurveySrsId(survey(UTM_37S)));
		assertFalse(GeoUtils.isUsingWGS84(survey(UTM_37S)));
		assertTrue(GeoUtils.isUsingWGS84(survey("LATLONG")));
		assertTrue(GeoUtils.isUsingWGS84(survey(SpatialReferenceSystem.LAT_LON_SRS_ID)));
	}

	@Test
	public void theRangeOfDegrees() {
		assertTrue(GeoUtils.isInWgs84Range(0, 0));
		assertTrue(GeoUtils.isInWgs84Range(90, 180));
		assertTrue(GeoUtils.isInWgs84Range(-90, -180));
		assertFalse(GeoUtils.isInWgs84Range(90.0001, 0));
		assertFalse(GeoUtils.isInWgs84Range(-90.0001, 0));
		assertFalse(GeoUtils.isInWgs84Range(0, 180.0001));
		assertFalse(GeoUtils.isInWgs84Range(0, -180.0001));
		// UTM 37S metres, as northing and easting
		assertFalse(GeoUtils.isInWgs84Range(9_857_000, 257_000));
		assertFalse(GeoUtils.isInWgs84Range(Double.NaN, 0));
	}

	// ---------- a plot ----------

	@Test
	public void aWgs84PlotIsTakenAsItIs() throws Exception {
		for (String srs : new String[] { null, "LATLONG", "EPSG:4326", " wgs84 " }) {
			SimplePlacemarkObject plot = generator().getPlotObject(new String[] { "7", "-1.2921", "36.8219" }, HEADER, survey(srs), false);
			assertEquals("-1.2921", plot.getCoord().getLatitude());
			assertEquals("36.8219", plot.getCoord().getLongitude());
		}
	}

	@Test
	public void aSurveyInAnotherSystemIsSaidPlainlyNotAsAnEpsgDatabaseError() {
		NotWgs84Exception e = assertThrows(NotWgs84Exception.class,
				() -> generator().getPlotObject(new String[] { "7", "9857000", "257000" }, HEADER, survey(UTM_37S), false));
		assertTrue(e.isAboutTheSurvey());
		assertEquals(UTM_37S, e.getSurveySrsId());
		assertNull(e.getCause());
		assertTrue(e.getMessage().contains(UTM_37S) && e.getMessage().contains("EPSG:4326"), e.getMessage());
		// even when the numbers would happen to be degrees: nothing is converted, so nothing is guessed
		assertThrows(NotWgs84Exception.class,
				() -> generator().getPlotObject(new String[] { "7", "-1.2", "36.8" }, HEADER, survey(UTM_37S), false));
	}

	@Test
	public void aPlotOutOfTheRangeOfDegreesIsRefusedWithItsId() {
		NotWgs84Exception e = assertThrows(NotWgs84Exception.class,
				() -> generator().getPlotObject(new String[] { "P12", "9857000", "257000" }, HEADER, survey("EPSG:4326"), false));
		assertFalse(e.isAboutTheSurvey());
		assertEquals("P12", e.getPlotId());
		assertThrows(NotWgs84Exception.class,
				() -> generator().getPlotObject(new String[] { "P13", "-1.29", "200" }, HEADER, survey(null), false));
		// a header row is still a header, not a plot out of range
		KmlGenerationException header = assertThrows(KmlGenerationException.class,
				() -> generator().getPlotObject(HEADER, HEADER, survey("EPSG:4326"), false));
		assertFalse(header instanceof NotWgs84Exception);
	}

	// ---------- the project opened ----------

	private KmlGeneratorService service(CollectSurvey survey) throws Exception {
		Path project = Files.createDirectories(folder.resolve("project"));
		File csv = project.resolve("plots.csv").toFile();
		Files.write(csv.toPath(), "id,YCoordinate,XCoordinate\n1,9857000,257000\n".getBytes(StandardCharsets.UTF_8));
		LocalPropertiesService properties = mock(LocalPropertiesService.class);
		when(properties.getCsvFile()).thenReturn(csv.getPath());
		when(properties.getBalloonFile()).thenReturn("");
		EarthSurveyService surveys = mock(EarthSurveyService.class);
		when(surveys.getCollectSurvey()).thenReturn(survey);
		KmlGeneratorService service = new KmlGeneratorService();
		service.localPropertiesService = properties;
		service.earthSurveyService = surveys;
		return service;
	}

	@Test
	public void aProjectInAnotherSystemOpensAndSaysWhatToDo() throws Exception {
		File generated = Files.createDirectories(folder.resolve("generated")).toFile();
		KmlGenerationException e = assertThrows(KmlGenerationException.class, () -> service(survey(UTM_37S)).prepareProjectFiles(generated));
		assertTrue(e.getMessage().contains(UTM_37S), e.getMessage());
		assertTrue(e.getMessage().contains("EPSG:4326"), e.getMessage());
		assertFalse(e.getMessage().contains("!KmlGeneratorService"), e.getMessage());
		assertFalse(e.getMessage().contains("NoSuchAuthorityCode"), e.getMessage());
		// a WGS84 one, or one without a system, as before
		service(survey("EPSG:4326")).prepareProjectFiles(generated);
		service(survey(null)).prepareProjectFiles(generated);
	}

	@Test
	public void theSurveysSystemIsEscapedInTheNotice() {
		String html = KmlGeneratorService.notWgs84SurveyMessage("EPSG:<b>1", true);
		assertTrue(html.contains("EPSG:&lt;b&gt;1"), html);
		String text = KmlGeneratorService.notWgs84SurveyMessage("EPSG:<b>1", false);
		assertTrue(text.contains("EPSG:<b>1"), text);
		assertFalse(text.contains("<br/>"), text);
	}

	@Test
	public void thePlotsOutOfRangeAreCountedAndAFewNamed() {
		String one = KmlGeneratorService.notWgs84PlotsMessage(1, Arrays.asList("P<1>"), true);
		assertTrue(one.contains("P&lt;1&gt;") && !one.contains("..."), one);
		String many = KmlGeneratorService.notWgs84PlotsMessage(12, Arrays.asList("1", "2", "3", "4", "5"), false);
		assertTrue(many.contains("12") && many.contains("1, 2, 3, 4, 5, ..."), many);
		assertFalse(many.contains("<br/>"), many);
	}

	// ---------- the plots map's index ----------

	private PlotFileIndex index(CollectSurvey survey, NoticeService notices, String settings) throws Exception {
		KmlGeneratorService shapes = mock(KmlGeneratorService.class);
		when(shapes.plotShapeSettings()).thenReturn(settings);
		when(shapes.getKmlGenerator()).thenReturn(generator());
		EarthSurveyService surveys = mock(EarthSurveyService.class);
		when(surveys.getCollectSurvey()).thenReturn(survey);
		PlotFileIndex index = new PlotFileIndex();
		index.kmlGeneratorService = shapes;
		index.earthSurveyService = surveys;
		index.notices = notices;
		return index;
	}

	private File plots(String... rows) throws Exception {
		File csv = folder.resolve("plots-" + System.nanoTime() + ".csv").toFile();
		Files.write(csv.toPath(), ("id,YCoordinate,XCoordinate\n" + String.join("\n", rows) + "\n").getBytes(StandardCharsets.UTF_8));
		return csv;
	}

	@Test
	public void thePlotsOutOfRangeAreLeftOutOfTheMapAndSaidOnce() throws Exception {
		NoticeService notices = new NoticeService();
		File csv = plots("a,-1.29,36.82", "u1,9857000,257000", "u2,9857100,257100", "b,-1.30,36.83", "u3,9857200,257200",
				"u4,9857300,257300", "u5,9857400,257400", "u6,9857500,257500");
		PlotFileIndex index = index(survey("EPSG:4326"), notices, "square");
		PlotFileIndex.PlotIndex plots = index.indexOf(csv.getPath());
		assertArrayEquals(new String[] { "a", "b" }, plots.ids);
		List<Map<String, Object>> pending = notices.pending();
		assertEquals(1, pending.size());
		String message = (String) pending.get(0).get("message");
		assertEquals("warning", pending.get(0).get("severity"));
		assertTrue(message.contains("u1, u2, u3, u4, u5, ..."), message);
		assertFalse(message.contains("u6"), message);
		assertTrue(message.contains("EPSG:4326"), message);

		// the plot settings changed: the file is read again, and not said again
		when(index.kmlGeneratorService.plotShapeSettings()).thenReturn("circle");
		index.indexOf(csv.getPath());
		assertEquals(1, notices.pending().size());
	}

	@Test
	public void aFileOfWgs84PlotsSaysNothing() throws Exception {
		NoticeService notices = new NoticeService();
		PlotFileIndex.PlotIndex plots = index(survey("LATLONG"), notices, "square").indexOf(plots("a,-1.29,36.82", "b,-1.30,36.83").getPath());
		assertEquals(2, plots.ids.length);
		assertTrue(notices.pending().isEmpty());
	}

	@Test
	public void aSurveyInAnotherSystemShowsNoPlotsAndLeavesTheMessageToTheProject() throws Exception {
		// said once by prepareProjectFiles, not by every plot
		NoticeService notices = new NoticeService();
		PlotFileIndex.PlotIndex plots = index(survey(UTM_37S), notices, "square")
				.indexOf(plots("u1,9857000,257000", "a,-1.29,36.82").getPath());
		assertEquals(0, plots.ids.length);
		assertTrue(notices.pending().isEmpty());
	}

	// ---------- every language ----------

	@Test
	public void theMessagesReadInEveryLanguage() throws Exception {
		for (String language : new String[] { "", "_es", "_fr", "_pt", "_tr" }) {
			Properties bundle = new Properties();
			try (InputStream in = getClass().getResourceAsStream("/org/openforis/collect/earth/app/view/Messages" + language + ".properties")) {
				bundle.load(in);
			}
			Locale locale = language.isEmpty() ? Locale.ENGLISH : new Locale(language.substring(1));
			String survey = new MessageFormat(bundle.getProperty("KmlGeneratorService.notWgs84Survey"), locale).format(new Object[] { UTM_37S });
			assertTrue(survey.contains(UTM_37S) && survey.contains("EPSG:4326") && survey.contains("WGS84"), language + ": " + survey);
			// a quote of MessageFormat left doubled, or a value left out
			assertFalse(survey.contains("{") || survey.contains("''"), language + ": " + survey);
			MessageFormat plots = new MessageFormat(bundle.getProperty("KmlGeneratorService.notWgs84Plots"), locale);
			for (int count : new int[] { 1, 2, 1200 }) {
				String text = plots.format(new Object[] { count, "u1, u2" });
				assertTrue(text.contains("u1, u2") && text.contains("EPSG:4326") && text.contains("-180"), language + ": " + text);
				assertFalse(text.contains("{"), language + ": " + text);
			}
			if (language.isEmpty()) {
				assertTrue(plots.format(new Object[] { 1, "u1" }).startsWith("One plot cannot be shown"));
				assertTrue(plots.format(new Object[] { 1200, "u1" }).startsWith("1,200 plots cannot be shown"));
			}
			assertTrue(bundle.getProperty("SettingsPage.sampleFile.wgs84").contains("EPSG:4326"), language);
			assertTrue(bundle.getProperty("SettingsPage.sampleFile.tooltip").contains("EPSG:4326"), language);
		}
	}
}

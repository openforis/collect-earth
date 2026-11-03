package org.openforis.collect.earth.app.service.settings;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.text.MessageFormat;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.view.Messages;

/** The rules of the Swing dialog, run by the server on the values the page holds. */
public class SettingsValidatorTest {

	private static final LocalDate TODAY = LocalDate.of(2026, 10, 30);

	private final SettingsValidator validator = new SettingsValidator(new SettingsModel(TODAY),
			folder -> folder.getName().equals("saiku-server_2.6"), () -> TODAY);

	private static Map<String, String> values(String... keysAndValues) {
		Map<String, String> values = new HashMap<>();
		for (int i = 0; i < keysAndValues.length; i += 2) {
			values.put(keysAndValues[i], keysAndValues[i + 1]);
		}
		return values;
	}

	/** A square plot of 25 points 10 m apart, with a square reference area at 50 m */
	private static Map<String, String> square25() {
		return values("sample_shape", "SQUARE", "number_of_sampling_points_in_plot", "25", "distance_between_sample_points", "10",
				"distance_to_plot_boundaries", "0", "inner_point_side", "2", "buffer_shape", "SQUARE", "distance_to_buffers", "50");
	}

	@Test
	public void aPortIsBlankOrANumberOfAPort() {
		assertNull(validator.validate(values("port", "")).getErrors().get("port"));
		assertNull(validator.validate(values("port", "8028")).getErrors().get("port"));
		assertEquals(Messages.getString("PropertyValidators.portRange"), validator.validate(values("port", "70000")).getErrors().get("port"));
		assertEquals(Messages.getString("PropertyValidators.portRange"), validator.validate(values("port", "x")).getErrors().get("port"));
		assertEquals(Messages.getString("PropertyValidators.portRange"),
				validator.validate(values("db_driver", "POSTGRESQL", "db_port", "0")).getErrors().get("db_port"));
	}

	@Test
	public void thePostgreSqlConnectionIsRequiredOnlyWithPostgreSql() {
		Validation postgres = validator.validate(values("db_driver", "POSTGRESQL", "db_host", "", "db_name", " ", "db_username", "u"));
		assertEquals(Messages.getString("PropertyValidators.required"), postgres.getErrors().get("db_host"));
		assertEquals(Messages.getString("PropertyValidators.required"), postgres.getErrors().get("db_name"));
		assertNull(postgres.getErrors().get("db_username"));
		assertNull(postgres.getErrors().get("db_password"));
		Validation sqlite = validator.validate(values("db_driver", "SQLITE", "db_host", ""));
		assertNull(sqlite.getErrors().get("db_host"));
		assertTrue(sqlite.isValid());
	}

	@Test
	public void aWholeNumberWithinItsRange() {
		Map<String, String> values = square25();
		values.put("distance_between_sample_points", "1001");
		assertEquals(String.format(Messages.getString("PropertyValidators.valueRange"), 2, 1000),
				validator.validate(values).getErrors().get("distance_between_sample_points"));
		values.put("distance_between_sample_points", "ten");
		assertEquals(String.format(Messages.getString("PropertyValidators.valueRange"), 2, 1000),
				validator.validate(values).getErrors().get("distance_between_sample_points"));
		values.put("distance_between_sample_points", "");
		assertFalse(validator.validate(values).isValid());
		values.put("distance_between_sample_points", " 10 ");
		assertNull(validator.validate(values).getErrors().get("distance_between_sample_points"));
	}

	@Test
	public void theReferenceAreaMustEncloseThePlotAndShouldBeTenTimesIt() {
		Map<String, String> values = square25();
		values.put("distance_to_buffers", "20");
		assertEquals(MessageFormat.format(Messages.getString("OptionWizard.1025"), 21),
				validator.validate(values).getErrors().get("distance_to_buffers"));
		values.put("distance_to_buffers", "50");
		Validation small = validator.validate(values);
		assertNull(small.getErrors().get("distance_to_buffers"));
		assertEquals(Messages.getString("OptionWizard.1024"), small.getWarnings().get("distance_to_buffers"));
		values.put("distance_to_buffers", "64");
		assertNull(validator.validate(values).getWarnings().get("distance_to_buffers"));
		// Not checked while there is no reference area, nor for a shape without one
		values.put("buffer_shape", "NONE");
		values.put("distance_to_buffers", "1");
		assertTrue(validator.validate(values).isValid());
		values.put("buffer_shape", "SQUARE");
		values.put("sample_shape", "KML_POLYGON");
		assertTrue(validator.validate(values).isValid());
	}

	@Test
	public void theExtraMapUrlIsAUrlWithPlaceholders() {
		assertEquals(Messages.getString("SettingsPage.extraMap.invalid"),
				validator.validate(values("extra_map_url", "not a url")).getErrors().get("extra_map_url"));
		Validation none = validator.validate(values("extra_map_url", "https://maps.example.org/plot"));
		assertTrue(none.isValid());
		assertEquals(Messages.getString("SettingsPage.extraMap.noPlaceholder"), none.getWarnings().get("extra_map_url"));
		assertEquals(Messages.getString("SettingsPage.extraMap.latLong"),
				validator.validate(values("extra_map_url", "https://maps.example.org/?lat=LATITUDE")).getWarnings().get("extra_map_url"));
		assertTrue(validator.validate(values("extra_map_url", "https://maps.example.org/?lat=LATITUDE&lon=LONGITUDE")).getWarnings().isEmpty());
		assertTrue(validator.validate(values("extra_map_url", "https://maps.example.org/?id=PLOT_ID")).getWarnings().isEmpty());
		assertTrue(validator.validate(values("extra_map_url", "")).getWarnings().isEmpty());
	}

	@Test
	public void theGeeAppDatesAreBlankOrDatesUpToTodayInOrder() {
		assertTrue(validator.validate(values("open_gee_app", "true", "geeapp_date_from", "", "geeapp_date_to", "")).isValid());
		assertTrue(validator.validate(values("open_gee_app", "true", "geeapp_date_from", "2000-01-01", "geeapp_date_to", "2026-10-30")).isValid());
		assertEquals(Messages.getString("SettingsPage.date.invalid"),
				validator.validate(values("open_gee_app", "true", "geeapp_date_from", "01/02/2020")).getErrors().get("geeapp_date_from"));
		assertEquals(Messages.getString("SettingsPage.date.invalid"),
				validator.validate(values("open_gee_app", "true", "geeapp_date_from", "1999-12-31")).getErrors().get("geeapp_date_from"));
		assertEquals(Messages.getString("SettingsPage.date.invalid"),
				validator.validate(values("open_gee_app", "true", "geeapp_date_to", "2026-10-31")).getErrors().get("geeapp_date_to"));
		assertEquals(Messages.getString("SettingsPage.date.order"),
				validator.validate(values("open_gee_app", "true", "geeapp_date_from", "2021-05-01", "geeapp_date_to", "2021-04-30")).getErrors()
						.get("geeapp_date_to"));
		// Not checked while the GEE App is off
		assertTrue(validator.validate(values("open_gee_app", "false", "geeapp_date_from", "yesterday")).isValid());
	}

	@Test
	public void planetWithoutAKeyAndAFolderThatIsNotSaikusAreWarnings() {
		Validation planet = validator.validate(values("open_planet_maps", "true", "planet_maps_key", " "));
		assertTrue(planet.isValid());
		assertEquals(Messages.getString("OptionWizard.1055"), planet.getWarnings().get("planet_maps_key"));
		assertTrue(validator.validate(values("open_planet_maps", "false", "planet_maps_key", "")).getWarnings().isEmpty());
		Validation saiku = validator.validate(values("saiku_server_folder", File.separator + "tmp" + File.separator + "elsewhere"));
		assertTrue(saiku.isValid());
		assertEquals(Messages.getString("OptionWizard.27"), saiku.getWarnings().get("saiku_server_folder"));
		assertTrue(validator.validate(values("saiku_server_folder", "saiku-server_2.6")).getWarnings().isEmpty());
		assertTrue(validator.validate(values("saiku_server_folder", "")).getWarnings().isEmpty());
	}

	@Test
	public void theFiguresOfThePlotAreAnswered() {
		Validation.PlotFigures plot = validator.validate(square25()).getPlot();
		assertEquals(0.16, plot.getPlotAreaHa(), 0.0001);
		assertEquals(1d, plot.getReferenceAreaHa(), 0.0001);
		assertEquals(21, plot.getMinReferenceDistance());
		assertEquals(64, plot.getRecommendedReferenceDistance());
		Map<String, String> none = square25();
		none.put("buffer_shape", "NONE");
		assertNull(validator.validate(none).getPlot().getReferenceAreaHa());
		assertNull(validator.validate(values("sample_shape", "KML_POLYGON")).getPlot());
		Map<String, Object> json = validator.validate(square25()).toJson();
		assertEquals(0.16, (Double) ((Map<?, ?>) json.get("plot")).get("plotAreaHa"), 0.0001);
		assertTrue(((Map<?, ?>) json.get("errors")).isEmpty());
	}

	@Test
	public void theFirstErrorOfASettingIsTheOneKept() {
		Map<String, String> values = square25();
		values.put("distance_to_buffers", "0");
		assertEquals(String.format(Messages.getString("PropertyValidators.valueRange"), 1, 10000),
				validator.validate(values).getErrors().get("distance_to_buffers"));
	}
}

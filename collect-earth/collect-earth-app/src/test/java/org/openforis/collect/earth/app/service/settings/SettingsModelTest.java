package org.openforis.collect.earth.app.service.settings;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.settings.Setting.Choice;
import org.openforis.collect.earth.app.view.Messages;

/** The description of the settings the page draws itself from: whole, translated, and showing what the Swing dialog showed. */
public class SettingsModelTest {

	private final SettingsModel model = new SettingsModel(LocalDate.of(2026, 10, 30));

	private static Map<String, String> values(String... keysAndValues) {
		Map<String, String> values = new HashMap<>();
		for (int i = 0; i < keysAndValues.length; i += 2) {
			values.put(keysAndValues[i], keysAndValues[i + 1]);
		}
		return values;
	}

	private List<String> visibleKeys(Map<String, String> values) {
		List<String> keys = new ArrayList<>();
		for (Setting setting : model.settings()) {
			if (setting.isVisible(values)) {
				keys.add(setting.key());
			}
		}
		return keys;
	}

	@Test
	public void theSectionsOfTheDesignInTheirOrder() {
		List<String> ids = new ArrayList<>();
		for (Section section : model.sections()) {
			ids.add(section.getId());
		}
		assertEquals(Arrays.asList("project", "plot", "imagery", "storage", "collaboration", "advanced"), ids);
	}

	@Test
	public void everySettingIsAPropertyAndNoneIsListedTwice() {
		Set<String> keys = new HashSet<>();
		for (Section section : model.sections()) {
			for (Setting setting : section.getSettings()) {
				assertTrue(keys.add(setting.key()), setting.key() + " is listed twice");
				assertNotNull(setting.getProperty());
				assertEquals(setting.getProperty().toString(), setting.key());
				assertEquals(setting, model.setting(setting.key()));
			}
		}
		assertEquals(keys.size(), model.settings().size());
	}

	@Test
	public void everyTextIsInMessagesProperties() {
		for (Section section : model.sections()) {
			assertText(section.getLabel());
			if (section.getHint() != null) {
				assertText(section.getHint());
			}
			for (Setting setting : section.getSettings()) {
				for (String label : setting.labelKeys()) {
					assertText(label);
				}
				assertNotNull(setting.getTooltip(), setting.key() + " has no tooltip");
				assertText(setting.getTooltip());
				for (Choice choice : setting.getChoices()) {
					if (choice.getLabel() != null) {
						assertText(choice.getLabel());
					}
					if (choice.getDescription() != null) {
						assertText(choice.getDescription());
					}
				}
			}
		}
	}

	private static void assertText(String key) {
		// Messages answers !key! for a key no bundle has
		assertFalse(Messages.getString(key).startsWith("!"), key + " is not in Messages.properties");
	}

	@Test
	public void thePlotSettingsFollowTheShape() {
		// A polygon read from the file has nothing to lay out
		assertEquals(Arrays.asList("sample_shape"), plotKeys(values("sample_shape", "KML_POLYGON")));
		// A square plot of one point is sized by its margin alone
		List<String> singlePoint = plotKeys(values("sample_shape", "SQUARE", "number_of_sampling_points_in_plot", "1", "buffer_shape", "NONE"));
		assertEquals(Arrays.asList("sample_shape", "number_of_sampling_points_in_plot", "distance_to_plot_boundaries", "inner_point_side",
				"buffer_shape"), singlePoint);
		// With points, their distance; without any, no dots to size
		assertTrue(plotKeys(values("sample_shape", "SQUARE", "number_of_sampling_points_in_plot", "4")).contains("distance_between_sample_points"));
		assertFalse(plotKeys(values("sample_shape", "SQUARE", "number_of_sampling_points_in_plot", "0")).contains("inner_point_side"));
		// The central plot of the square that has one
		assertTrue(plotKeys(values("sample_shape", "SQUARE_WITH_LARGE_CENTRAL_PLOT")).contains("large_central_plot_side"));
		assertFalse(plotKeys(values("sample_shape", "SQUARE")).contains("large_central_plot_side"));
		// A round plot has a radius and no margin
		Map<String, String> circle = values("sample_shape", "CIRCLE", "number_of_sampling_points_in_plot", "4", "buffer_shape", "SQUARE");
		assertTrue(plotKeys(circle).contains("distance_between_sample_points"));
		assertFalse(plotKeys(circle).contains("distance_to_plot_boundaries"));
		assertEquals("OptionWizard.132", model.setting("distance_between_sample_points").label(circle));
		assertEquals("OptionWizard.36", model.setting("distance_between_sample_points").label(values("sample_shape", "SQUARE")));
		// The reference area distance only with a shape for it
		assertTrue(plotKeys(circle).contains("distance_to_buffers"));
		assertFalse(plotKeys(values("sample_shape", "HEXAGON", "buffer_shape", "NONE")).contains("distance_to_buffers"));
		// A cluster: the radius of its plots, their dots and the distance between them, no reference area
		List<String> nfi = plotKeys(values("sample_shape", "NFI_THREE_CIRCLES", "buffer_shape", "SQUARE"));
		assertEquals(Arrays.asList("sample_shape", "distance_between_sample_points", "inner_point_side", "distance_between_plots"), nfi);
		assertEquals("OptionWizard.133", model.setting("distance_between_sample_points").label(values("sample_shape", "NFI_FOUR_CIRCLES")));
	}

	private List<String> plotKeys(Map<String, String> values) {
		List<String> keys = new ArrayList<>();
		for (Setting setting : model.sections().get(1).getSettings()) {
			if (setting.isVisible(values)) {
				keys.add(setting.key());
			}
		}
		return keys;
	}

	@Test
	public void theOtherSectionsFollowTheirSwitches() {
		List<String> sqlite = visibleKeys(values("db_driver", "SQLITE", "viewer_type", "google_earth_pro"));
		assertTrue(sqlite.contains("automatic_backup"));
		assertFalse(sqlite.contains("db_host"));
		assertTrue(sqlite.contains("open_separate_browser_form"));
		assertFalse(sqlite.contains("map_engine"));
		assertFalse(sqlite.contains("window_layout"));
		assertFalse(sqlite.contains("web_form"));
		List<String> postgres = visibleKeys(values("db_driver", "POSTGRESQL", "viewer_type", "plots_map", "open_gee_app", "true",
				"open_planet_maps", "true", "planet_maps_use_tfo", "true"));
		assertFalse(postgres.contains("automatic_backup"));
		assertTrue(postgres.containsAll(Arrays.asList("db_host", "db_port", "db_name", "db_username", "db_password")));
		assertTrue(postgres.containsAll(Arrays.asList("map_engine", "window_layout", "web_form", "geeapp_date_from", "geeapp_date_to",
				"planet_maps_key", "planet_maps_use_tfo", "planet_tfo_date_from", "planet_tfo_date_to")));
		assertFalse(postgres.contains("open_separate_browser_form"));
		List<String> cloud = visibleKeys(values("db_driver", "CLOUD", "open_gee_app", "false", "open_planet_maps", "true"));
		assertTrue(cloud.contains("automatic_backup"));
		assertFalse(cloud.contains("geeapp_date_from"));
		assertFalse(cloud.contains("planet_tfo_date_from"));
		assertTrue(cloud.containsAll(Arrays.asList("cloud_sync_url", "cloud_project_id", "cloud_sync_token")));
	}

	@Test
	public void onlyTheSettingsANewServerReadsRestart() {
		Set<String> restart = new HashSet<>();
		for (Setting setting : model.settings()) {
			if (setting.isRestart()) {
				restart.add(setting.key());
			}
		}
		assertEquals(new HashSet<>(Arrays.asList("db_driver", "db_host", "db_port", "db_name", "db_username", "db_password", "port", "use_browser")),
				restart);
	}

	@Test
	public void onlyTheSettingsTheGeneratorsReadWhateverTheShapeAreBlankedWhenHidden() {
		Set<String> blanked = new HashSet<>();
		for (Setting setting : model.settings()) {
			if (setting.isBlankWhenHidden()) {
				blanked.add(setting.key());
			}
		}
		assertEquals(new HashSet<>(Arrays.asList("distance_between_sample_points", "large_central_plot_side")), blanked);
	}

	@Test
	public void theRequiredOnesAreThePostgreSqlConnection() {
		Set<String> required = new HashSet<>();
		for (Setting setting : model.settings()) {
			if (setting.isRequired()) {
				required.add(setting.key());
			}
		}
		assertEquals(new HashSet<>(Arrays.asList("db_host", "db_name", "db_username")), required);
	}

	@Test
	public void thePlanetMonthsAreTheOnesAvailableToday() {
		List<Choice> from = model.setting("planet_tfo_date_from").getChoices();
		assertEquals("", from.get(0).getValue());
		assertEquals("PlanetMonthlyObject.1", from.get(0).getLabel());
		assertEquals("2015-12_2016-05", from.get(1).getValue());
		assertEquals("2026-09", from.get(from.size() - 1).getValue());
		List<Choice> to = model.setting("planet_tfo_date_to").getChoices();
		assertEquals("PlanetMonthlyObject.2", to.get(0).getLabel());
		assertEquals(from.size(), to.size());
	}

	@Test
	@SuppressWarnings("unchecked")
	public void isSentToThePageAsJson() {
		Map<String, Object> distance = model.setting("distance_to_buffers").toJson();
		assertEquals("distance_to_buffers", distance.get("key"));
		assertEquals("integer", distance.get("type"));
		assertEquals("OptionWizard.1023", distance.get("label"));
		assertEquals("100", distance.get("default"));
		assertEquals(1, distance.get("min"));
		assertEquals(10000, distance.get("max"));
		assertEquals(false, distance.get("restart"));
		assertEquals(false, distance.get("required"));
		assertEquals(SettingsModel.REFERENCE_AREA.toJson(), distance.get("visible"));
		Map<String, Object> radius = model.setting("distance_between_sample_points").toJson();
		List<Map<String, Object>> labels = (List<Map<String, Object>>) radius.get("labels");
		assertEquals(2, labels.size());
		assertEquals("OptionWizard.132", labels.get(0).get("label"));
		assertEquals(SettingsModel.ROUND_PLOT.toJson(), labels.get(0).get("when"));
		Map<String, Object> viewer = model.setting("viewer_type").toJson();
		List<Map<String, Object>> choices = (List<Map<String, Object>>) viewer.get("choices");
		assertEquals("plots_map", choices.get(1).get("value"));
		assertEquals("ExternalServicesPanel.viewerType.plots_map", choices.get(1).get("label"));
		assertEquals("ExternalServicesPanel.viewerHelp.plots_map", choices.get(1).get("description"));
		assertFalse(viewer.containsKey("visible"));
		Map<String, Object> points = model.setting("number_of_sampling_points_in_plot").toJson();
		List<Map<String, Object>> options = (List<Map<String, Object>>) points.get("choices");
		assertEquals("4", options.get(2).get("value"));
		assertEquals("2x2", options.get(2).get("text"));
		Map<String, Object> csv = model.setting("csv").toJson();
		assertEquals(Arrays.asList("csv", "ced"), csv.get("extensions"));
		assertEquals("file", csv.get("type"));
		List<Map<String, Object>> sections = model.toJson();
		assertEquals(6, sections.size());
		assertEquals("plot", sections.get(1).get("id"));
		assertEquals("SettingsPage.collaboration.hint", sections.get(4).get("hint"));
		assertEquals(9, ((List<?>) sections.get(1).get("fields")).size());
		assertEquals(EarthProperty.SAMPLE_SHAPE.toString(), ((List<Map<String, Object>>) sections.get(1).get("fields")).get(0).get("key"));
	}
}

package org.openforis.collect.earth.app.service.settings;

import static org.openforis.collect.earth.app.service.settings.Condition.all;
import static org.openforis.collect.earth.app.service.settings.Condition.any;
import static org.openforis.collect.earth.app.service.settings.Condition.atLeast;
import static org.openforis.collect.earth.app.service.settings.Condition.in;
import static org.openforis.collect.earth.app.service.settings.Condition.notBlank;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.BUFFER_SHAPE;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.settings.PlanetMonths.Month;

/**
 * The settings of the settings page, by section, from the inventory of the Swing properties dialog
 * (docs/plans/2026-10-30-settings-inventory.md): what each is, when it is shown, what Restore defaults sets, and
 * which restart Collect Earth. Their rules are in SettingsValidator. A new setting is a line here, and its field,
 * visibility and texts follow on the page.
 */
public final class SettingsModel {

	public static final String PROJECT = "project";
	public static final String PLOT = "plot";
	public static final String IMAGERY = "imagery";
	public static final String STORAGE = "storage";

	/** The plot shapes laid out as a square, with a grid of points inside a margin */
	static final Condition SQUARE_PLOT = in(EarthProperty.SAMPLE_SHAPE, SAMPLE_SHAPE.SQUARE, SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT);
	/** The plot shapes laid out around a centre and a radius */
	static final Condition ROUND_PLOT = in(EarthProperty.SAMPLE_SHAPE, SAMPLE_SHAPE.CIRCLE, SAMPLE_SHAPE.HEXAGON);
	static final Condition NFI_CLUSTER = in(EarthProperty.SAMPLE_SHAPE, SAMPLE_SHAPE.NFI_THREE_CIRCLES, SAMPLE_SHAPE.NFI_FOUR_CIRCLES);
	static final Condition SQUARE_OR_ROUND = any(SQUARE_PLOT, ROUND_PLOT);
	static final Condition REFERENCE_AREA = all(SQUARE_OR_ROUND,
			in(EarthProperty.BUFFER_SHAPE, BUFFER_SHAPE.SQUARE, BUFFER_SHAPE.CIRCLE, BUFFER_SHAPE.HEXAGON));
	static final Condition POSTGRESQL = in(EarthProperty.DB_DRIVER, CollectDBDriver.POSTGRESQL);
	static final Condition SQLITE_FILE = in(EarthProperty.DB_DRIVER, CollectDBDriver.SQLITE, CollectDBDriver.CLOUD);
	/** A cloud project: a local one has no server, project or token to show */
	static final Condition CLOUD_PROJECT = in(EarthProperty.DB_DRIVER, CollectDBDriver.CLOUD);
	static final Condition GEE_APP = in(EarthProperty.OPEN_GEE_APP, "true");
	/** Planet is offered once its key is set: without one it shows nothing */
	static final Condition PLANET = notBlank(EarthProperty.PLANET_MAPS_KEY);
	static final Condition PLANET_TFO = all(PLANET, in(EarthProperty.PLANET_MAPS_USE_TFO, "true"));

	private final List<Section> sections;
	private final Map<String, Setting> byKey = new LinkedHashMap<>();

	/** For today, which decides the Planet months offered. */
	public SettingsModel() {
		this(LocalDate.now());
	}

	public SettingsModel(LocalDate today) {
		sections = Collections.unmodifiableList(Arrays.asList(project(), plot(), imagery(today), storage()));
		for (Section section : sections) {
			for (Setting setting : section.getSettings()) {
				byKey.put(setting.key(), setting);
			}
		}
	}

	public List<Section> sections() {
		return sections;
	}

	/** Every setting, in the order of the page. */
	public List<Setting> settings() {
		return new ArrayList<>(byKey.values());
	}

	/** The setting stored under this key, or null. */
	public Setting setting(String key) {
		return byKey.get(key);
	}

	/**
	 * The section (PLOT or IMAGERY) of a setting a cloud project's coordinator sets in the project file, or null for the
	 * collector's own: the plot design, and the imagery windows but the Planet key, which is each person's Planet account.
	 */
	public String coordinatorsSection(Setting setting) {
		for (Section section : sections) {
			boolean coordinators = PLOT.equals(section.getId())
					|| IMAGERY.equals(section.getId()) && setting.getProperty() != EarthProperty.PLANET_MAPS_KEY;
			if (coordinators && section.getSettings().contains(setting)) {
				return section.getId();
			}
		}
		return null;
	}

	/** The properties of the coordinator's settings of the section (PLOT or IMAGERY), see coordinatorsSection. */
	public List<EarthProperty> coordinatorsProperties(String sectionId) {
		List<EarthProperty> list = new ArrayList<>();
		for (Setting setting : settings()) {
			if (sectionId.equals(coordinatorsSection(setting))) {
				list.add(setting.getProperty());
			}
		}
		return list;
	}

	public List<Map<String, Object>> toJson() {
		List<Map<String, Object>> json = new ArrayList<>();
		for (Section section : sections) {
			json.add(section.toJson());
		}
		return json;
	}

	private static Section project() {
		return new Section(PROJECT, "SettingsPage.section.project",
				// Blank, as in a new installation, is no choice: BrowserService tries the installed browsers in its own order.
				// First, above the plots file and its preview: it was the only setting of a section of its own (Advanced)
				Setting.choice(EarthProperty.BROWSER_TO_USE, "OptionWizard.1").tooltip("SettingsPage.browser.tooltip").restart()
						.option("", "SettingsPage.browser.automatic")
						.option(EarthConstants.FIREFOX_BROWSER, "SettingsPage.browser.firefox")
						.option(EarthConstants.CHROME_BROWSER, "SettingsPage.browser.chrome")
						.option(EarthConstants.EDGE_BROWSER, "SettingsPage.browser.edge"),
				Setting.file(EarthProperty.SAMPLE_FILE, "OptionWizard.49", "csv", "ced").tooltip("SettingsPage.sampleFile.tooltip"),
				// Its choices are the versions of the survey loaded, given with the settings (SettingsController); a survey
				// with one version or none does not show it. The records and the form of a version differ: restart
				Setting.choice(EarthProperty.MODEL_VERSION_NAME, "SettingsPage.surveyVersion").tooltip("SettingsPage.surveyVersion.tooltip")
						.restart());
	}

	private static Section plot() {
		Setting shape = Setting.choice(EarthProperty.SAMPLE_SHAPE, "OptionWizard.128").tooltip("SettingsPage.shape.tooltip")
				.defaultValue(SAMPLE_SHAPE.SQUARE.name());
		for (SAMPLE_SHAPE value : SAMPLE_SHAPE.values()) {
			shape.option(value, "SettingsPage.shape." + value.name());
		}
		Setting points = Setting.choice(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT, "OptionWizard.35")
				.tooltip("SettingsPage.points.tooltip").defaultValue("25").visibleWhen(SQUARE_OR_ROUND)
				.option("0", "OptionWizard.53").option("1", "OptionWizard.54");
		for (int side = 2; side <= 10; side++) {
			points.optionText(String.valueOf(side * side), side + "x" + side);
		}
		Setting bufferShape = Setting.choice(EarthProperty.BUFFER_SHAPE, "OptionWizard.1022").tooltip("SettingsPage.bufferShape.tooltip")
				.defaultValue(BUFFER_SHAPE.NONE.name()).visibleWhen(SQUARE_OR_ROUND);
		for (BUFFER_SHAPE value : BUFFER_SHAPE.values()) {
			bufferShape.option(value, "SettingsPage.bufferShape." + value.name());
		}
		return new Section(PLOT, "OptionWizard.32",
				shape,
				points,
				Setting.integer(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS, "OptionWizard.36", PlotGeometry.MIN_DISTANCE_BETWEEN_POINTS,
						PlotGeometry.MAX_DISTANCE_BETWEEN_POINTS).tooltip("OptionWizard.1027")
						.defaultValue(String.valueOf(PlotGeometry.DEFAULT_DISTANCE_BETWEEN_POINTS))
						// The same setting is the distance between the points of a square plot, the radius of a round one and
						// the radius of the plots of a cluster
						.labelWhen(ROUND_PLOT, "OptionWizard.132").labelWhen(NFI_CLUSTER, "OptionWizard.133")
						.visibleWhen(any(ROUND_PLOT, all(SQUARE_PLOT, atLeast(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT, 2)), NFI_CLUSTER))
						// SquareKmlGenerator sizes the square by it whatever the number of points: a square of one point keeps
						// its size only while it is blank
						.blankWhenHidden(),
				Setting.integer(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, "OptionWizard.37", PlotGeometry.MIN_MARGIN, PlotGeometry.MAX_MARGIN)
						.tooltip("OptionWizard.1028").defaultValue(String.valueOf(PlotGeometry.DEFAULT_MARGIN)).visibleWhen(SQUARE_PLOT),
				Setting.integer(EarthProperty.INNER_SUBPLOT_SIDE, "OptionWizard.95", PlotGeometry.MIN_INNER_SIDE, PlotGeometry.MAX_INNER_SIDE)
						.tooltip("OptionWizard.1029").defaultValue(String.valueOf(PlotGeometry.DEFAULT_INNER_SIDE))
						// Without points there are no dots to size
						.visibleWhen(any(all(SQUARE_OR_ROUND, atLeast(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT, 1)), NFI_CLUSTER)),
				Setting.integer(EarthProperty.LARGE_CENTRAL_PLOT_SIDE, "OptionWizard.129", PlotGeometry.MIN_CENTRAL_PLOT_SIDE,
						PlotGeometry.MAX_CENTRAL_PLOT_SIDE).tooltip("OptionWizard.1030")
						.defaultValue(String.valueOf(PlotGeometry.DEFAULT_CENTRAL_PLOT_SIDE))
						.visibleWhen(in(EarthProperty.SAMPLE_SHAPE, SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT))
						// SquareKmlGenerator draws a central plot in any square plot that has a side for it
						.blankWhenHidden(),
				Setting.integer(EarthProperty.DISTANCE_BETWEEN_PLOTS, "OptionWizard.130", PlotGeometry.MIN_DISTANCE_BETWEEN_PLOTS,
						PlotGeometry.MAX_DISTANCE_BETWEEN_PLOTS).tooltip("OptionWizard.1031")
						.defaultValue(String.valueOf(PlotGeometry.DEFAULT_DISTANCE_BETWEEN_PLOTS)).visibleWhen(NFI_CLUSTER),
				bufferShape,
				Setting.integer(EarthProperty.DISTANCE_TO_BUFFERS, "OptionWizard.1023", PlotGeometry.MIN_REFERENCE_DISTANCE,
						PlotGeometry.MAX_REFERENCE_DISTANCE).tooltip("SettingsPage.referenceDistance.tooltip")
						.defaultValue(String.valueOf(PlotGeometry.DEFAULT_REFERENCE_DISTANCE)).visibleWhen(REFERENCE_AREA));
	}

	private static Section imagery(LocalDate today) {
		Setting from = Setting.choice(EarthProperty.PLANET_TFO_DATE_FROM, "OptionWizard.142").tooltip("OptionWizard.1040")
				.visibleWhen(PLANET_TFO).option("", "PlanetMonthlyObject.1");
		Setting to = Setting.choice(EarthProperty.PLANET_TFO_DATE_TO, "OptionWizard.143").tooltip("OptionWizard.1041")
				.visibleWhen(PLANET_TFO).option("", "PlanetMonthlyObject.2");
		for (Month month : PlanetMonths.available(today)) {
			from.optionText(month.getValue(), month.getLabel());
			to.optionText(month.getValue(), month.getLabel());
		}
		return new Section(IMAGERY, "SettingsPage.section.imagery",
				Setting.bool(EarthProperty.OPEN_GEE_APP, "OptionWizard.136").tooltip("SettingsPage.geeApp.tooltip").defaultValue("true"),
				Setting.date(EarthProperty.GEEAPP_FROM_DATE, "OptionWizard.121").tooltip("OptionWizard.1038").visibleWhen(GEE_APP),
				Setting.date(EarthProperty.GEEAPP_TO_DATE, "OptionWizard.122").tooltip("OptionWizard.1039").visibleWhen(GEE_APP),
				Setting.bool(EarthProperty.OPEN_EARTH_MAP, "OptionWizard.105").tooltip("SettingsPage.earthMap.tooltip").defaultValue("false"),
				Setting.bool(EarthProperty.OPEN_ESRI_WAYBACK, "OptionWizard.144").tooltip("SettingsPage.esriWayback.tooltip").defaultValue("false"),
				Setting.password(EarthProperty.PLANET_MAPS_KEY, "OptionWizard.101").tooltip("OptionWizard.1053"),
				Setting.bool(EarthProperty.PLANET_MAPS_USE_TFO, "OptionWizard.140").tooltip("SettingsPage.planetTfo.tooltip").defaultValue("false")
						.visibleWhen(PLANET),
				from,
				to,
				Setting.text(EarthProperty.EXTRA_MAP_URL, "OptionWizard.103").tooltip("OptionWizard.1042"));
	}

	private static Section storage() {
		return new Section(STORAGE, "SettingsPage.section.storage",
				Setting.choice(EarthProperty.DB_DRIVER, "SettingsPage.dbDriver").tooltip("SettingsPage.dbDriver.tooltip")
						.defaultValue(CollectDBDriver.SQLITE.name()).restart()
						.option(CollectDBDriver.SQLITE, "OptionWizard.93")
						.option(CollectDBDriver.POSTGRESQL, "OptionWizard.94")
						.option(CollectDBDriver.CLOUD, "DatabaseServerPanel.cloudOption"),
				Setting.bool(EarthProperty.AUTOMATIC_BACKUP, "SettingsPage.automaticBackup").tooltip("SettingsPage.automaticBackup.tooltip")
						.defaultValue("true").visibleWhen(SQLITE_FILE),
				Setting.text(EarthProperty.DB_HOST, "OptionWizard.26").tooltip("OptionWizard.1035").required().restart().visibleWhen(POSTGRESQL),
				Setting.text(EarthProperty.DB_PORT, "OptionWizard.29").tooltip("OptionWizard.1036").defaultValue("5432").restart()
						.visibleWhen(POSTGRESQL),
				Setting.text(EarthProperty.DB_NAME, "OptionWizard.9").tooltip("OptionWizard.1034").required().restart().visibleWhen(POSTGRESQL),
				Setting.text(EarthProperty.DB_USERNAME, "OptionWizard.7").tooltip("OptionWizard.1032").required().restart().visibleWhen(POSTGRESQL),
				Setting.password(EarthProperty.DB_PASSWORD, "OptionWizard.8").tooltip("OptionWizard.1033").restart().visibleWhen(POSTGRESQL),
				// The cloud project the records are synchronised with, under the choice that stores them there (it was a
				// section of its own, Collaboration, empty but for a cloud project)
				Setting.text(EarthProperty.CLOUD_SYNC_URL, "DatabaseServerPanel.cloudUrlLabel").tooltip("DatabaseServerPanel.cloudUrlTooltip")
						.visibleWhen(CLOUD_PROJECT),
				Setting.text(EarthProperty.CLOUD_PROJECT_ID, "DatabaseServerPanel.cloudProjectLabel").tooltip("DatabaseServerPanel.cloudProjectTooltip")
						.visibleWhen(CLOUD_PROJECT),
				Setting.password(EarthProperty.CLOUD_SYNC_TOKEN, "DatabaseServerPanel.cloudTokenLabel").tooltip("DatabaseServerPanel.cloudTokenTooltip")
						.visibleWhen(CLOUD_PROJECT));
	}
}

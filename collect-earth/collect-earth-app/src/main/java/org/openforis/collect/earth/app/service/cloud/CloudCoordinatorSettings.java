package org.openforis.collect.earth.app.service.cloud;

import java.io.IOException;
import java.net.URI;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.service.settings.SettingsModel;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * In a cloud project the plot layout (Settings > Plot) and the imagery windows (Settings > Imagery but the Planet key)
 * are the coordinator's, who can change them on the dashboard's Project file tab. During the cloud sync
 * (CloudSyncService) the ones of the project file on the server are asked for every few minutes, the first time at the
 * first sync after the start; the settings with another value are written as loading the coordinator's project file
 * writes them (EarthProjectsService.applyPropertiesToCollectEarth, key by key: SettingsService refuses them in a cloud
 * project), the plots are drawn again (the windows of the next plot are opened with the settings then) and the collector
 * is told. Nothing else is touched: not the records, not the other settings, not the survey.
 */
@Component
public class CloudCoordinatorSettings {

	/** The notices' kinds */
	public static final String NOTICE = "cloudPlotLayout"; //$NON-NLS-1$
	public static final String NOTICE_IMAGERY = "cloudImagery"; //$NON-NLS-1$
	/** How often the server is asked */
	static final long CHECK_INTERVAL_MS = 2 * 60 * 1000L;

	/** The settings of the project file on the server, by property name; empty when it has none (or no project file) */
	interface SettingsSource {
		Map<String, String> fetch() throws IOException;
	}

	/** A group of the coordinator's settings: its section, where they are read, its notice and how it says them */
	private static final class Part {
		final String section;
		final SettingsSource source;
		final String notice;
		final String messages;
		final Supplier<String> describe;

		Part(String section, SettingsSource source, String notice, String messages, Supplier<String> describe) {
			this.section = section;
			this.source = source;
			this.notice = notice;
			this.messages = messages;
			this.describe = describe;
		}
	}

	private final Logger logger = LoggerFactory.getLogger(CloudCoordinatorSettings.class);
	private final LocalPropertiesService properties;
	private final NoticeService notices;
	private final Runnable reload;
	private final List<Part> parts = new ArrayList<>();
	private volatile long lastCheck = Long.MIN_VALUE;

	@Autowired
	public CloudCoordinatorSettings(LocalPropertiesService properties, CloudApiClient api, @Autowired(required = false) NoticeService notices) {
		this(properties, api::getPlotLayout, api::getImagery, notices, EarthApp::reloadPlots);
	}

	CloudCoordinatorSettings(LocalPropertiesService properties, SettingsSource layout, SettingsSource imagery, NoticeService notices, Runnable reload) {
		this.properties = properties;
		this.notices = notices;
		this.reload = reload;
		parts.add(new Part(SettingsModel.PLOT, layout, NOTICE, "CloudPlotLayout", this::describeLayout)); //$NON-NLS-1$
		parts.add(new Part(SettingsModel.IMAGERY, imagery, NOTICE_IMAGERY, "CloudImagery", this::describeImagery)); //$NON-NLS-1$
	}

	/** The properties of the coordinator's settings of a section of the settings (SettingsModel.PLOT or IMAGERY) */
	static List<EarthProperty> coordinatorsProperties(String section) {
		return new SettingsModel().coordinatorsProperties(section);
	}

	/** Checks unless the last check is less than CHECK_INTERVAL_MS old; called by every sync cycle. */
	void checkIfDue(long now) {
		if (lastCheck != Long.MIN_VALUE && now - lastCheck < CHECK_INTERVAL_MS) {
			return;
		}
		lastCheck = now;
		check();
	}

	/**
	 * Applies the coordinator's settings where they differ from the collector's; never throws. A part the server cannot
	 * give is asked again at the next check, the others are applied.
	 *
	 * @return the settings written, by property name (empty: nothing changed or the server not reached)
	 */
	Map<String, String> check() {
		Map<String, String> all = new LinkedHashMap<>();
		List<Part> told = new ArrayList<>();
		for (Part part : parts) {
			Map<String, String> changed = apply(part);
			if (!changed.isEmpty()) {
				all.putAll(changed);
				told.add(part);
			}
		}
		if (all.isEmpty()) {
			return all;
		}
		reload.run();
		if (notices != null) {
			for (Part part : told) {
				notices.post(new Notice(part.notice, Notice.INFO, Messages.getString(part.messages + ".title"), //$NON-NLS-1$
						MessageFormat.format(Messages.getString(part.messages + ".changed"), part.describe.get()))); //$NON-NLS-1$
			}
		}
		return all;
	}

	private Map<String, String> apply(Part part) {
		Map<String, String> changed = new LinkedHashMap<>();
		try {
			Map<String, String> values = part.source.fetch();
			for (EarthProperty property : coordinatorsProperties(part.section)) {
				String value = values.get(property.toString());
				if (value != null && !value.trim().equals(StringUtils.trimToEmpty(properties.getValue(property)))) {
					changed.put(property.toString(), value.trim());
				}
			}
			for (Map.Entry<String, String> entry : changed.entrySet()) {
				properties.setValue(entry.getKey(), entry.getValue());
			}
			if (!changed.isEmpty()) {
				logger.info("The coordinator changed the {} settings: {}", part.section, changed); //$NON-NLS-1$
			}
		} catch (IOException | RuntimeException e) {
			// Offline, or a server without the route (older, or the local one): asked again later
			logger.debug("The {} settings of the cloud project could not be checked: {}", part.section, e.getMessage()); //$NON-NLS-1$
		}
		return changed;
	}

	/** The layout now, in words: its shape, and its sampling points for the shapes that have them. */
	private String describeLayout() {
		String shape = StringUtils.defaultIfBlank(properties.getValue(EarthProperty.SAMPLE_SHAPE), "SQUARE").trim().toUpperCase(); //$NON-NLS-1$
		String words = Messages.getString("SettingsPage.shape." + shape); //$NON-NLS-1$
		String points = StringUtils.trimToEmpty(properties.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT));
		if (shape.startsWith("SQUARE") || "CIRCLE".equals(shape) || "HEXAGON".equals(shape)) { //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			if (StringUtils.isNumeric(points)) {
				words += MessageFormat.format(Messages.getString("CloudPlotLayout.points"), points); //$NON-NLS-1$
			}
		}
		return words;
	}

	/**
	 * The windows opened beside Google Earth now, as BrowserService.enabledImagerySources decides them, by their names (the
	 * extra map by its site); Planet only with the collector's own key.
	 */
	private String describeImagery() {
		List<String> windows = new ArrayList<>();
		if (isOn(EarthProperty.OPEN_ESRI_WAYBACK)) {
			windows.add("ESRI Wayback"); //$NON-NLS-1$
		}
		// Planet with its switch on (on unless false, as LocalPropertiesService.isPlanetMapsSupported reads it) and the key
		if (!"false".equalsIgnoreCase(StringUtils.trimToEmpty(properties.getValue(EarthProperty.OPEN_PLANET_MAPS))) //$NON-NLS-1$
				&& StringUtils.isNotBlank(properties.getValue(EarthProperty.PLANET_MAPS_KEY))) {
			windows.add("Planet"); //$NON-NLS-1$
		}
		if (isOn(EarthProperty.OPEN_GEE_APP)) {
			windows.add("Earth Engine"); //$NON-NLS-1$
		}
		if (isOn(EarthProperty.OPEN_EARTH_MAP)) {
			windows.add("Earth Map"); //$NON-NLS-1$
		}
		if (isOn(EarthProperty.OPEN_STREET_VIEW)) {
			windows.add("Street View"); //$NON-NLS-1$
		}
		String extra = StringUtils.trimToEmpty(properties.getValue(EarthProperty.EXTRA_MAP_URL));
		if (!extra.isEmpty()) {
			windows.add(StringUtils.defaultIfBlank(hostOf(extra), extra));
		}
		return windows.isEmpty() ? Messages.getString("CloudImagery.none") : String.join(", ", windows); //$NON-NLS-1$ //$NON-NLS-2$
	}

	private boolean isOn(EarthProperty property) {
		return Boolean.parseBoolean(StringUtils.trimToEmpty(properties.getValue(property)));
	}

	private static String hostOf(String url) {
		try {
			return new URI(url.replace(" ", "%20")).getHost(); //$NON-NLS-1$ //$NON-NLS-2$
		} catch (Exception e) {
			return null;
		}
	}
}

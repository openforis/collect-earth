package org.openforis.collect.earth.app.service.cloud;

import java.io.IOException;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.service.settings.Section;
import org.openforis.collect.earth.app.service.settings.Setting;
import org.openforis.collect.earth.app.service.settings.SettingsModel;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * In a cloud project the plot layout (Settings > Plot) is the coordinator's, who can change it on the dashboard's Project
 * file tab. During the cloud sync (CloudSyncService) the layout of the project file on the server is asked for every few
 * minutes, the first time at the first sync after the start; the settings of the Plot section it has with another value
 * are written as loading the coordinator's project file writes them (EarthProjectsService.applyPropertiesToCollectEarth,
 * key by key: SettingsService refuses them in a cloud project), the plots are drawn again and the collector is told.
 * Nothing else is touched: not the records, not the other settings, not the survey.
 */
@Component
public class CloudPlotLayout {

	/** The notices' kind */
	public static final String NOTICE = "cloudPlotLayout"; //$NON-NLS-1$
	/** How often the server is asked */
	static final long CHECK_INTERVAL_MS = 2 * 60 * 1000L;

	/** The layout of the project file on the server, by property name; empty when it has none (or no project file) */
	interface LayoutSource {
		Map<String, String> fetch() throws IOException;
	}

	private final Logger logger = LoggerFactory.getLogger(CloudPlotLayout.class);
	private final LocalPropertiesService properties;
	private final LayoutSource source;
	private final NoticeService notices;
	private final Runnable reload;
	private volatile long lastCheck = Long.MIN_VALUE;

	@Autowired
	public CloudPlotLayout(LocalPropertiesService properties, CloudApiClient api, @Autowired(required = false) NoticeService notices) {
		this(properties, api::getPlotLayout, notices, EarthApp::reloadPlots);
	}

	CloudPlotLayout(LocalPropertiesService properties, LayoutSource source, NoticeService notices, Runnable reload) {
		this.properties = properties;
		this.source = source;
		this.notices = notices;
		this.reload = reload;
	}

	/** The properties of the Plot section of the settings */
	static List<EarthProperty> plotProperties() {
		List<EarthProperty> list = new ArrayList<>();
		for (Section section : new SettingsModel().sections()) {
			if (SettingsModel.PLOT.equals(section.getId())) {
				for (Setting setting : section.getSettings()) {
					list.add(setting.getProperty());
				}
			}
		}
		return list;
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
	 * Applies the coordinator's layout where it differs from the settings; never throws.
	 *
	 * @return the settings written, by property name (empty: nothing changed or the server not reached)
	 */
	Map<String, String> check() {
		Map<String, String> changed = new LinkedHashMap<>();
		try {
			Map<String, String> layout = source.fetch();
			for (EarthProperty property : plotProperties()) {
				String value = layout.get(property.toString());
				if (value != null && !value.trim().equals(StringUtils.trimToEmpty(properties.getValue(property)))) {
					changed.put(property.toString(), value.trim());
				}
			}
			if (changed.isEmpty()) {
				return changed;
			}
			for (Map.Entry<String, String> entry : changed.entrySet()) {
				properties.setValue(entry.getKey(), entry.getValue());
			}
			logger.info("The coordinator changed the plot layout: {}", changed); //$NON-NLS-1$
			reload.run();
			if (notices != null) {
				notices.post(new Notice(NOTICE, Notice.INFO, Messages.getString("CloudPlotLayout.title"), //$NON-NLS-1$
						MessageFormat.format(Messages.getString("CloudPlotLayout.changed"), describe()))); //$NON-NLS-1$
			}
		} catch (IOException | RuntimeException e) {
			// Offline, or a server without the plot layout (older, or the local one): asked again later
			logger.debug("The plot layout of the cloud project could not be checked: {}", e.getMessage()); //$NON-NLS-1$
		}
		return changed;
	}

	/** The layout now, in words: its shape, and its sampling points for the shapes that have them. */
	private String describe() {
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
}

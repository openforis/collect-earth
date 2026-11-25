package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Map;
import java.util.function.Supplier;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * The survey's guide: the document that says how to interpret the plots. From 2.0 it is an address the project file
 * carries ({@code survey_guide_url} in project_definition.properties), of a document kept on a server (the cloud
 * project's, or anywhere), opened in the browser: the project file stays light (the IPCC demo survey's guide is 8 MB).
 * A project file of before keeps its guide inside ({@code survey_guide.pdf}), which is still read; with both, the
 * address wins (it is the newer).
 * <p>
 * In a cloud project the coordinator sets the guide on the dashboard: during the cloud sync the address is asked for
 * every few minutes ({@link #checkIfDue}) and written here when it changed, as the plot layout is
 * (CloudCoordinatorSettings).
 */
@Component
public class SurveyGuide {

	/** How often the server is asked */
	static final long CHECK_INTERVAL_MS = 2 * 60 * 1000L;

	/** The address of the cloud project's guide, by property name ({@code survey_guide_url}); empty from a server without guides */
	public interface AddressSource {
		Map<String, String> fetch() throws IOException;
	}

	private final Logger logger = LoggerFactory.getLogger(SurveyGuide.class);
	private final LocalPropertiesService properties;
	private final Supplier<File> bundled;
	private volatile long lastCheck = Long.MIN_VALUE;

	@Autowired
	public SurveyGuide(LocalPropertiesService properties, EarthSurveyService surveys) {
		this(properties, surveys::getSurveyGuide);
	}

	SurveyGuide(LocalPropertiesService properties, Supplier<File> bundled) {
		this.properties = properties;
		this.bundled = bundled;
	}

	/** A web address a guide can be opened from: http or https, with a host; null for anything else. */
	public static URI addressOf(String raw) {
		String text = StringUtils.trimToNull(raw);
		if (text == null) {
			return null;
		}
		try {
			URI uri = new URI(text);
			String scheme = uri.getScheme();
			boolean web = "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme); //$NON-NLS-1$ //$NON-NLS-2$
			return web && StringUtils.isNotBlank(uri.getHost()) ? uri : null;
		} catch (URISyntaxException e) {
			return null;
		}
	}

	/** The guide's address, of the project file or the cloud project; null without one. */
	public URI address() {
		return addressOf(properties.getValue(EarthProperty.SURVEY_GUIDE_URL));
	}

	/** The guide inside the project file (survey_guide.pdf), as before 2.0; null without one. */
	public File file() {
		File file = bundled.get();
		return file != null && file.exists() && file.canRead() ? file : null;
	}

	/** Whether the survey has a guide to open. */
	public boolean exists() {
		return address() != null || file() != null;
	}

	/** Asks the cloud project for its guide unless the last time is less than CHECK_INTERVAL_MS ago; called by every sync cycle. */
	public boolean checkIfDue(long now, AddressSource source) {
		if (lastCheck != Long.MIN_VALUE && now - lastCheck < CHECK_INTERVAL_MS) {
			return false;
		}
		lastCheck = now;
		return check(source);
	}

	/**
	 * Takes the cloud project's guide where it differs from the one here (set, changed or removed by the coordinator);
	 * never throws: a server that cannot be reached, or has no guides, leaves everything as it is.
	 *
	 * @return whether the address changed
	 */
	boolean check(AddressSource source) {
		try {
			String value = source.fetch().get(EarthProperty.SURVEY_GUIDE_URL.toString());
			if (value == null) {
				return false;
			}
			String now = value.trim();
			// only an address a browser opens is kept; "" takes the guide away
			if (!now.isEmpty() && addressOf(now) == null) {
				return false;
			}
			if (now.equals(StringUtils.trimToEmpty(properties.getValue(EarthProperty.SURVEY_GUIDE_URL)))) {
				return false;
			}
			properties.setValue(EarthProperty.SURVEY_GUIDE_URL, now);
			return true;
		} catch (Exception e) {
			logger.info("The survey guide of the cloud project could not be asked for: {}", e.getMessage()); //$NON-NLS-1$
			return false;
		}
	}
}

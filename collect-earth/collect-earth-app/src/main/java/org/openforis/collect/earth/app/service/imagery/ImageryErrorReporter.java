package org.openforis.collect.earth.app.service.imagery;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import io.sentry.Breadcrumb;
import io.sentry.Sentry;
import io.sentry.SentryLevel;

/**
 * Sends the faults of the imagery window to Sentry, as the rest of Collect Earth does through the log, but not through
 * the log: an ERROR there also opens the error dialog, and these happen on a plot change, possibly on every one.
 * <ul>
 * <li>Only faults of Collect Earth come here (a BiDi command that fails, a script of ours that throws in a page). A site
 * that is slow or down, a window the user closed, stay warnings in the log.</li>
 * <li>Each kind of error of each source is sent once per session: an error on every plot would otherwise use up the
 * quota of the error reports, as the unreadable balloon value did for nine days in 2026.</li>
 * <li>Breadcrumbs say what the imagery window did before the error.</li>
 * </ul>
 */
@Component
public class ImageryErrorReporter {

	private static final String BREADCRUMB_CATEGORY = "imagery";

	private final Logger logger = LoggerFactory.getLogger(ImageryErrorReporter.class);
	private final Set<String> reported = ConcurrentHashMap.newKeySet();
	private volatile String browser = "unknown";
	private volatile String browserVersion = "unknown";
	private volatile String viewerType = "unknown";

	public void setBrowser(String name, String version) {
		browser = String.valueOf(name);
		browserVersion = String.valueOf(version);
	}

	public void setViewerType(String viewerType) {
		this.viewerType = String.valueOf(viewerType);
	}

	/** Something the imagery window did, for the context of a later report. */
	public void breadcrumb(ImagerySource source, String message) {
		Breadcrumb breadcrumb = new Breadcrumb();
		breadcrumb.setCategory(BREADCRUMB_CATEGORY);
		breadcrumb.setLevel(SentryLevel.INFO);
		breadcrumb.setMessage(message);
		if (source != null) {
			breadcrumb.setData("source", source.name());
		}
		Sentry.addBreadcrumb(breadcrumb);
	}

	/**
	 * Logs the error as a warning and sends it to Sentry the first time this kind of error happens for this source.
	 *
	 * @param kind a short code of what failed: {@code page_script}, {@code bidi_command}, {@code no_bidi_browser}...
	 * @return whether it was sent
	 */
	public boolean report(ImagerySource source, String kind, Throwable error) {
		logger.warn("Imagery window, {}: {}", source, kind, error);
		if (!reported.add(source + "/" + kind)) {
			return false;
		}
		Map<String, String> tags = new LinkedHashMap<>();
		tags.put("imagery.source", String.valueOf(source));
		tags.put("imagery.error", kind);
		tags.put("browser", browser);
		tags.put("browser.version", browserVersion);
		tags.put("bidi", "true");
		tags.put("viewer_type", viewerType);
		send(tags, error);
		return true;
	}

	/** Overridden by the tests. */
	void send(Map<String, String> tags, Throwable error) {
		Sentry.withScope(scope -> {
			tags.forEach(scope::setTag);
			Sentry.captureException(error);
		});
	}
}

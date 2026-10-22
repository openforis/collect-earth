package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import org.junit.jupiter.api.Test;

import io.sentry.SentryLevel;

public class ImageryErrorReporterTest {

	/** Records what would be sent to Sentry. */
	static class RecordingReporter extends ImageryErrorReporter {
		final List<Map<String, String>> sent = new CopyOnWriteArrayList<>();
		final List<SentryLevel> levels = new CopyOnWriteArrayList<>();

		@Override
		void send(Map<String, String> tags, Throwable error, SentryLevel level) {
			sent.add(tags);
			levels.add(level);
		}
	}

	@Test
	public void eachKindOfErrorOfASourceIsReportedOncePerSession() {
		RecordingReporter reporter = new RecordingReporter();
		assertTrue(reporter.report(ImagerySource.ESRI_WAYBACK, "page_script", new PageScriptException("x")));
		assertFalse(reporter.report(ImagerySource.ESRI_WAYBACK, "page_script", new PageScriptException("y")));
		// Another kind, another source: reported
		assertTrue(reporter.report(ImagerySource.ESRI_WAYBACK, "bidi_command", new IllegalStateException()));
		assertTrue(reporter.report(ImagerySource.GOOGLE_EARTH_WEB, "page_script", new PageScriptException("z")));
		assertEquals(3, reporter.sent.size());
	}

	@Test
	public void theReportSaysWhichSourceAndBrowser() {
		RecordingReporter reporter = new RecordingReporter();
		reporter.setBrowser("firefox", "158.0");
		reporter.setViewerType("google_earth_web");
		reporter.report(ImagerySource.PLANET, "page_script", new PageScriptException("x"));
		Map<String, String> tags = reporter.sent.get(0);
		assertEquals("PLANET", tags.get("imagery.source"));
		assertEquals("firefox", tags.get("browser"));
		assertEquals("158.0", tags.get("browser.version"));
		assertEquals("true", tags.get("bidi"));
		assertEquals("google_earth_web", tags.get("viewer_type"));
	}
}

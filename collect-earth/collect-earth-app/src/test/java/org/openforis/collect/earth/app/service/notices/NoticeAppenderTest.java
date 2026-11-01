package org.openforis.collect.earth.app.service.notices;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.impl.Log4jLogEvent;
import org.apache.logging.log4j.core.layout.PatternLayout;
import org.apache.logging.log4j.message.SimpleMessage;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.logging.NoticeAppender;

/** The errors logged as notices: one at a time, the rest counted. */
public class NoticeAppenderTest {

	private final NoticeService notices = new NoticeService();
	private boolean shownSetting = true;
	private final NoticeAppender appender = new NoticeAppender(notices, () -> shownSetting,
			PatternLayout.newBuilder().withPattern("%-5p %c: %m%n").build(), null);

	private static LogEvent error(String message) {
		return Log4jLogEvent.newBuilder().setLoggerName("org.openforis.Test").setLevel(Level.ERROR).setMessage(new SimpleMessage(message)).build();
	}

	@Test
	public void anErrorLoggedIsANoticeAndTheNextOnesAreCountedUntilItIsAnswered() {
		appender.append(error("The KML could not be generated"));
		appender.append(error("Second"));
		appender.append(error("Third"));
		List<Map<String, Object>> pending = notices.pending();
		assertEquals(1, pending.size());
		assertEquals("error", pending.get(0).get("kind"));
		assertTrue(pending.get(0).get("message").toString().startsWith("ERROR org.openforis.Test: The KML could not be generated"));
		// Answered: the two counted become one notice
		notices.answer((String) pending.get(0).get("id"), "ok");
		pending = notices.pending();
		assertEquals(1, pending.size());
		assertTrue(pending.get(0).get("message").toString().startsWith("2 more errors"));
		// Answered with nothing counted meanwhile: the next error is a notice of its own again
		notices.answer((String) pending.get(0).get("id"), "ok");
		assertTrue(notices.pending().isEmpty());
		appender.append(error("Fourth"));
		assertTrue(notices.pending().get(0).get("message").toString().contains("Fourth"));
	}

	@Test
	public void nothingWhenTheUserDoesNotWantThem() {
		shownSetting = false;
		appender.append(error("Boom"));
		assertTrue(notices.pending().isEmpty());
		// The Help menu switches it on without the setting being read again
		appender.setShown(true);
		appender.append(error("Boom"));
		assertEquals(1, notices.pending().size());
	}
}

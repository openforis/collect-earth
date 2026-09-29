package org.openforis.collect.earth.app.logging;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.InvocationTargetException;
import java.util.ArrayList;
import java.util.List;

import javax.swing.SwingUtilities;

import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.config.Property;
import org.apache.logging.log4j.core.impl.Log4jLogEvent;
import org.apache.logging.log4j.core.layout.PatternLayout;
import org.apache.logging.log4j.message.SimpleMessage;
import org.junit.jupiter.api.Test;

class JSwingAppenderTest {

	/**
	 * Records the dialogs instead of showing them, and runs what happens while one is open : a modal dialog keeps
	 * dispatching events, so errors can be logged, and appended, before it returns.
	 */
	private static class RecordingAppender extends JSwingAppender {
		final List<String> shownMessages = new ArrayList<>();
		int openDialogs = 0;
		int maximumOpenDialogs = 0;
		Runnable whileFirstDialogOpen = () -> {};

		RecordingAppender() {
			super("test", null, PatternLayout.createDefaultLayout(), true, Property.EMPTY_ARRAY);
			setExceptionShown(true);
		}

		@Override
		void showErrorDialog(String message) {
			openDialogs++;
			maximumOpenDialogs = Math.max(maximumOpenDialogs, openDialogs);
			shownMessages.add(message);

			Runnable whileOpen = whileFirstDialogOpen;
			whileFirstDialogOpen = () -> {};
			whileOpen.run();

			openDialogs--;
		}
	}

	private static LogEvent error(String message) {
		return Log4jLogEvent.newBuilder().setLevel(Level.ERROR).setMessage(new SimpleMessage(message)).build();
	}

	private static void waitForEventThread() throws InterruptedException, InvocationTargetException {
		// The dialogs are shown from the event thread; this runs after whatever was queued before it
		SwingUtilities.invokeAndWait(() -> {});
	}

	// What crashed 1.23.18 : a save logged hundreds of parsing errors, each opened a dialog inside the previous one
	@Test
	void errorsLoggedWhileADialogIsOpenDoNotOpenMoreDialogs() throws Exception {
		RecordingAppender appender = new RecordingAppender();
		appender.whileFirstDialogOpen = () -> {
			for (int i = 0; i < 300; i++) {
				appender.append(error("parsing error " + i));
			}
		};

		appender.append(error("first error"));
		waitForEventThread();
		waitForEventThread();

		assertEquals(1, appender.maximumOpenDialogs, "A dialog was opened inside another one");
		assertEquals(2, appender.shownMessages.size());
		assertTrue(appender.shownMessages.get(0).contains("first error"));
		assertEquals(String.format(JSwingAppender.MORE_ERRORS_MESSAGE, 300), appender.shownMessages.get(1));
	}

	@Test
	void errorsFromOtherThreadsWhileADialogIsOpenAreCounted() throws Exception {
		RecordingAppender appender = new RecordingAppender();
		appender.whileFirstDialogOpen = () -> {
			Thread server = new Thread(() -> {
				for (int i = 0; i < 5; i++) {
					appender.append(error("server error " + i));
				}
			});
			server.start();
			try {
				server.join();
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
		};

		appender.append(error("first error"));
		waitForEventThread();

		assertEquals(2, appender.shownMessages.size());
		assertEquals(String.format(JSwingAppender.MORE_ERRORS_MESSAGE, 5), appender.shownMessages.get(1));
	}

	@Test
	void anErrorAfterTheDialogsAreClosedOpensANewDialog() throws Exception {
		RecordingAppender appender = new RecordingAppender();

		appender.append(error("first error"));
		waitForEventThread();
		appender.append(error("second error"));
		waitForEventThread();

		assertEquals(2, appender.shownMessages.size());
		assertTrue(appender.shownMessages.get(1).contains("second error"));
	}

	@Test
	void nothingIsShownWhenTheUserTurnedTheDialogsOff() throws Exception {
		RecordingAppender appender = new RecordingAppender();
		appender.setExceptionShown(false);

		appender.append(error("an error"));
		waitForEventThread();

		assertTrue(appender.shownMessages.isEmpty());
	}
}

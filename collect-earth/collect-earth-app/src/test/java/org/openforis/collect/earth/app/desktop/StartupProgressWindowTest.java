package org.openforis.collect.earth.app.desktop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.view.Messages;

/** The window that says Collect Earth is starting or restarting, as far as it can be tested without a screen. */
public class StartupProgressWindowTest {

	@AfterEach
	void clear() {
		System.clearProperty(StartupProgressWindow.RESTARTING_PROPERTY);
	}

	@Test
	public void a_process_started_by_a_restart_says_restarting() {
		Messages.setLocale(Locale.ENGLISH);
		assertFalse(StartupProgressWindow.isRestart());
		assertEquals("Starting Collect Earth", StartupProgressWindow.startTitle());
		System.setProperty(StartupProgressWindow.RESTARTING_PROPERTY, "true");
		assertTrue(StartupProgressWindow.isRestart());
		assertEquals("Restarting Collect Earth to apply your changes", StartupProgressWindow.startTitle());
	}

	@Test
	public void every_step_has_its_words_in_the_four_main_languages() {
		String[] keys = { "starting", "restarting", "hint", "saving", "relaunching", "database", "project", "plots", "window" };
		for (Locale locale : new Locale[] { Locale.ENGLISH, new Locale("es"), Locale.FRENCH, new Locale("pt") }) {
			Messages.setLocale(locale);
			for (String key : keys) {
				String text = Messages.getString("StartupWindow." + key);
				assertFalse(text.startsWith("!"), locale + " " + key);
			}
			assertFalse(Messages.getString("WindowClosed.quit").startsWith("!"), locale + " quit");
		}
		Messages.setLocale(new Locale("es"));
		assertEquals("Salir de Collect Earth", Messages.getString("WindowClosed.quit"));
		Messages.setLocale(Locale.ENGLISH);
	}

	@Test
	public void long_texts_wrap_and_are_shown_as_text() {
		String html = StartupProgressWindow.wrapped("Plots <1> & more");
		assertTrue(html.startsWith("<html>"));
		assertTrue(html.contains("Plots &lt;1&gt; &amp; more"));
		assertTrue(html.contains("width:380px"));
	}

	@Test
	public void without_a_screen_showing_and_closing_do_nothing() {
		System.setProperty("java.awt.headless", "true");
		StartupProgressWindow.show("Starting");
		StartupProgressWindow.step("Opening the database");
		StartupProgressWindow.close();
	}
}

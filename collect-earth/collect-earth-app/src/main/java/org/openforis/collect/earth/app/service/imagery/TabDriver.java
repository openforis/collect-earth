package org.openforis.collect.earth.app.service.imagery;

import java.util.function.BiConsumer;
import java.util.function.Consumer;

import org.openqa.selenium.remote.RemoteWebDriver;

/**
 * One browser and its tabs, as {@code ImageryBrowser} needs them. A tab is a BiDi browsing context id. Every call is
 * made from the one worker thread of {@code ImageryBrowser}. Calls on a tab that is gone throw
 * {@link TabClosedException}.
 */
public interface TabDriver {

	/** The tab the browser opened with (blank), used for the first source instead of leaving it empty. */
	String initialTab();

	/** Opens a tab without selecting it, at the end of the tab strip. */
	String createTab();

	/** Starts loading the page and returns without waiting for it. */
	void navigate(String tab, String url);

	/** Starts reloading the page and returns without waiting for it. */
	void reload(String tab);

	/**
	 * Evaluates a JavaScript expression in the page and returns its value as JSON text.
	 *
	 * @throws PageScriptException when the expression throws in the page
	 */
	String evaluate(String tab, String expression);

	/** Selects the tab (brings it to the front of its window). */
	void activate(String tab);

	boolean isAlive();

	void quit();

	/** Called with the tab id when a tab is closed (by the user, mostly). */
	void onTabClosed(Consumer<String> listener);

	/** Called with the tab id and whether its page is now visible (the selected tab of the window). */
	void onVisibilityChange(BiConsumer<String, Boolean> listener);

	/** The classic WebDriver of the window, to move and size it; may be null (tests). */
	RemoteWebDriver window();

	String browserName();

	String browserVersion();
}

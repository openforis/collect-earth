package org.openforis.collect.earth.app.service.imagery;

import java.util.function.BiConsumer;
import java.util.function.Consumer;

import org.openqa.selenium.remote.RemoteWebDriver;

/**
 * One browser and its tabs, as {@code ImageryBrowser} needs them. A tab is a BiDi browsing context id. Calls on a tab
 * that is gone throw {@link TabClosedException}.
 * <p>
 * Threads: {@link #isAlive()} and {@link #quit()} may be called from any thread (to see whether the user closed the
 * window, to end a browser that hung) and must not send BiDi commands; {@code isAlive} may make a classic WebDriver
 * call. Every other method is called only from the one worker thread of {@code ImageryBrowser}.
 */
public interface TabDriver {

	/** The tab the browser opened with (blank), used for the first source instead of leaving it empty. */
	String initialTab();

	/**
	 * Opens a tab without selecting it, at the end of the tab strip of the window of {@code besideTab}; of the window the
	 * browser chooses (the last one used) when null.
	 */
	String createTab(String besideTab);

	/** Opens a new window, without bringing it in front of the others, and returns its one tab. */
	String createWindow();

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

	/** Whether the browser still runs; any thread, no BiDi command. */
	boolean isAlive();

	/** Ends the browser and its driver service, failing a command stuck in it; any thread, no BiDi command. */
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

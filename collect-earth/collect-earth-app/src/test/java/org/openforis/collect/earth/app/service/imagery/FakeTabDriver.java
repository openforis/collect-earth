package org.openforis.collect.earth.app.service.imagery;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

import org.openqa.selenium.remote.RemoteWebDriver;

/**
 * A browser in memory: which calls were made, in which order, and pages that answer what the test says. Safe across
 * threads, as the worker of {@code ImageryBrowser} and the test thread both use it.
 */
class FakeTabDriver implements TabDriver {

	final List<String> calls = Collections.synchronizedList(new ArrayList<>());
	/** Answer of an evaluate whose expression contains the key; no two keys may match one expression. */
	final Map<String, String> answers = new ConcurrentHashMap<>();
	final List<String> tabs = Collections.synchronizedList(new ArrayList<>());
	private final List<Consumer<String>> closedListeners = new CopyOnWriteArrayList<>();
	private final List<BiConsumer<String, Boolean>> visibilityListeners = new CopyOnWriteArrayList<>();
	volatile boolean alive = true;
	/** When set, the first navigate waits for it: the test queues more work behind it. */
	volatile CountDownLatch holdFirstNavigate;
	private int created;

	FakeTabDriver() {
		tabs.add("tab0");
	}

	@Override public String initialTab() { return "tab0"; }

	@Override public synchronized String createTab() {
		String tab = "tab" + (++created);
		tabs.add(tab);
		calls.add("create " + tab);
		return tab;
	}

	@Override public void navigate(String tab, String url) {
		check(tab);
		CountDownLatch hold = holdFirstNavigate;
		if (hold != null) {
			holdFirstNavigate = null;
			try { hold.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
			check(tab); // a real browser fails a navigation of a tab closed meanwhile
		}
		calls.add("navigate " + tab + " " + url);
	}

	@Override public void reload(String tab) { check(tab); calls.add("reload " + tab); }

	@Override public String evaluate(String tab, String expression) {
		check(tab);
		calls.add("evaluate " + tab);
		for (Map.Entry<String, String> answer : answers.entrySet()) {
			if (expression.contains(answer.getKey())) {
				return answer.getValue();
			}
		}
		return "null";
	}

	@Override public void activate(String tab) { check(tab); calls.add("activate " + tab); }
	@Override public boolean isAlive() { return alive; }
	@Override public void quit() { alive = false; calls.add("quit"); }
	@Override public void onTabClosed(Consumer<String> listener) { closedListeners.add(listener); }
	@Override public void onVisibilityChange(BiConsumer<String, Boolean> listener) { visibilityListeners.add(listener); }
	@Override public RemoteWebDriver window() { return null; }
	@Override public String browserName() { return "fake"; }
	@Override public String browserVersion() { return "1"; }

	/** The user closes the tab. */
	void close(String tab) {
		tabs.remove(tab);
		closedListeners.forEach(l -> l.accept(tab));
	}

	/** The user selects the tab. */
	void select(String tab) {
		for (String other : new ArrayList<>(tabs)) {
			visibilityListeners.forEach(l -> l.accept(other, other.equals(tab)));
		}
	}

	private void check(String tab) {
		if (!alive || !tabs.contains(tab)) {
			throw new TabClosedException(tab + " is closed", null);
		}
	}
}

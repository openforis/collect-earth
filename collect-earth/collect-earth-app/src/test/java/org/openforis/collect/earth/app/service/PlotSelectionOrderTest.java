package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;

/**
 * The numbers the plot selections take ({@link PlotImageryService}) and the order Google Earth Web shows them in
 * ({@link GoogleEarthWebService#showPlot}): a plot selected before the one shown is never shown after it, and the imagery
 * window opened again shows the plot shown last whatever was shown in Google Earth Web meanwhile.
 */
public class PlotSelectionOrderTest {

	/** Google Earth Web as the viewer, recording the plots it shows instead of showing them. */
	static class RecordingGoogleEarthWeb extends GoogleEarthWebService {
		final List<String> shown = Collections.synchronizedList(new ArrayList<>());
		volatile CountDownLatch inShow;
		volatile CountDownLatch release;

		@Override
		boolean isTheViewer() {
			return true;
		}

		@Override
		void showSelected(SimplePlacemarkObject plot) {
			shown.add(plot.getPlacemarkId());
			CountDownLatch entered = inShow;
			if (entered != null) {
				inShow = null;
				entered.countDown();
				await(release);
			}
		}
	}

	/** The plot imagery, on the calling thread, sending to {@link #gew} and recording the other sources' loads. */
	static class RecordingPlotImagery extends PlotImageryService {
		final RecordingGoogleEarthWeb gew = new RecordingGoogleEarthWeb();
		final List<String> otherSources = Collections.synchronizedList(new ArrayList<>());
		/** Plots whose filling waits for their latch. */
		final java.util.Map<String, CountDownLatch> heldFills = new ConcurrentHashMap<>();
		final Set<String> failingFills = ConcurrentHashMap.newKeySet();

		RecordingPlotImagery() {
			async = Runnable::run;
		}

		@Override
		void fillPlot(SimplePlacemarkObject placemark, KmlGenerator kmlGenerator) throws KmlGenerationException {
			CountDownLatch held = heldFills.remove(placemark.getPlacemarkId());
			if (held != null) {
				await(held);
			}
			if (failingFills.remove(placemark.getPlacemarkId())) {
				throw new KmlGenerationException("cannot fill " + placemark.getPlacemarkId());
			}
		}

		@Override
		void sendToGoogleEarthWeb(SimplePlacemarkObject placemark, long selection) {
			gew.showPlot(placemark, selection);
		}

		@Override
		void loadInOtherSources(SimplePlacemarkObject placemark, long selection) {
			otherSources.add(placemark.getPlacemarkId());
		}

		@Override
		void openImageryTabs() {
			// no browser
		}
	}

	static SimplePlacemarkObject plot(String id) {
		return new SimplePlacemarkObject(new double[] { 1, 2 }, id);
	}

	static void await(CountDownLatch latch) {
		try {
			assertTrue(latch.await(5, TimeUnit.SECONDS));
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}

	@Test
	public void theImageryWindowOpenedAgainShowsThePlotAfterGoogleEarthWebWasShownByItself() {
		RecordingPlotImagery imagery = new RecordingPlotImagery();
		imagery.showPlot(plot("A"), null);
		// The plots map's "show in Google Earth Web": a number of its own
		imagery.showInGoogleEarthWeb(plot("A"), null);
		// The user closed the imagery window and asked for it back
		assertTrue(imagery.reopenImagery());
		assertEquals(Arrays.asList("A", "A", "A"), imagery.gew.shown);
		assertEquals(Arrays.asList("A", "A"), imagery.otherSources);
	}

	@Test
	@Timeout(10)
	public void goingABAQuicklyShowsTheSecondA() throws Exception {
		RecordingPlotImagery imagery = new RecordingPlotImagery();
		imagery.showPlot(plot("A"), null);
		CountDownLatch fillB = new CountDownLatch(1);
		imagery.heldFills.put("B", fillB);
		Thread b = new Thread(() -> imagery.showPlot(plot("B"), null));
		b.start();
		while (imagery.heldFills.containsKey("B")) {
			Thread.sleep(10); // B is being filled
		}
		// A again while B is filled in: shown, although A was the plot shown last
		imagery.showPlot(plot("A"), null);
		fillB.countDown();
		b.join();
		// B, selected before the second A, is never shown
		assertEquals(Arrays.asList("A", "A"), imagery.gew.shown);
		assertEquals(Arrays.asList("A", "A"), imagery.otherSources);
	}

	@Test
	public void aPlotThatCouldNotBeFilledInIsTriedAgainWhenSelectedAgain() {
		RecordingPlotImagery imagery = new RecordingPlotImagery();
		imagery.failingFills.add("A");
		imagery.showPlot(plot("A"), null);
		imagery.showPlot(plot("A"), null);
		assertEquals(Arrays.asList("A"), imagery.gew.shown);
		// Selected again once shown: not shown again
		imagery.showPlot(plot("A"), null);
		assertEquals(Arrays.asList("A"), imagery.gew.shown);
	}

	@Test
	public void theImageryWindowOpenedAgainLeavesItToAPlotBeingSelected() throws Exception {
		RecordingPlotImagery imagery = new RecordingPlotImagery();
		imagery.showPlot(plot("A"), null);
		CountDownLatch fillB = new CountDownLatch(1);
		imagery.heldFills.put("B", fillB);
		Thread b = new Thread(() -> imagery.showPlot(plot("B"), null));
		b.start();
		while (imagery.heldFills.containsKey("B")) {
			Thread.sleep(10);
		}
		assertTrue(imagery.reopenImagery());
		fillB.countDown();
		b.join();
		// Not A again over the window: B shows itself in it
		assertEquals(Arrays.asList("A", "B"), imagery.gew.shown);
		assertEquals(Arrays.asList("A", "B"), imagery.otherSources);
	}

	@Test
	public void googleEarthWebShowsAPlotSelectedBeforeTheOneShownNever() {
		RecordingGoogleEarthWeb gew = new RecordingGoogleEarthWeb();
		gew.showPlot(plot("B"), 2);
		gew.showPlot(plot("A"), 1);
		// The same selection again (the window opened again on it) is shown
		gew.showPlot(plot("B"), 2);
		gew.showPlot(plot("C"), 3);
		assertEquals(Arrays.asList("B", "B", "C"), gew.shown);
	}

	@Test
	@Timeout(10)
	public void googleEarthWebShowsTheLatestOfThePlotsThatCameWhileItWasBusy() throws Exception {
		RecordingGoogleEarthWeb gew = new RecordingGoogleEarthWeb();
		CountDownLatch inShow = new CountDownLatch(1);
		gew.inShow = inShow;
		gew.release = new CountDownLatch(1);
		Thread first = new Thread(() -> gew.showPlot(plot("P1"), 1));
		first.start();
		await(inShow);
		// While P1 is shown, P3 and then P2 (selected before P3, its thread late) arrive
		Thread third = new Thread(() -> gew.showPlot(plot("P3"), 3));
		third.start();
		waitUntilBlocked(third);
		Thread second = new Thread(() -> gew.showPlot(plot("P2"), 2));
		second.start();
		waitUntilBlocked(second);
		gew.release.countDown();
		first.join();
		third.join();
		second.join();
		assertEquals(Arrays.asList("P1", "P3"), gew.shown);
	}

	private static void waitUntilBlocked(Thread thread) throws InterruptedException {
		while (thread.getState() != Thread.State.BLOCKED) {
			Thread.sleep(5);
		}
	}
}

package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.openforis.collect.earth.app.service.PlotSelectionOrderTest.RecordingGoogleEarthWeb;

/**
 * A plot being shown in Google Earth Web is given up when a plot selected after it waits ({@link
 * GoogleEarthWebService#isSuperseded()}), and only then: never for a plot selected before it.
 */
public class GoogleEarthWebSupersedeTest {

	@Test
	@Timeout(10)
	public void aPlotSelectedLaterWaitingSupersedesThePlotBeingShown() throws Exception {
		RecordingGoogleEarthWeb gew = new RecordingGoogleEarthWeb();
		CountDownLatch inShow = new CountDownLatch(1);
		gew.inShow = inShow;
		gew.release = new CountDownLatch(1);
		Thread first = new Thread(() -> gew.showPlot(PlotSelectionOrderTest.plot("P1"), 2));
		first.start();
		PlotSelectionOrderTest.await(inShow);
		assertFalse(gew.isSuperseded());
		// A plot selected before P1, its thread late, waits: P1 goes on
		Thread earlier = new Thread(() -> gew.showPlot(PlotSelectionOrderTest.plot("P0"), 1));
		earlier.start();
		waitUntilBlocked(earlier);
		assertFalse(gew.isSuperseded());
		// One selected after it: P1 is given up
		Thread later = new Thread(() -> gew.showPlot(PlotSelectionOrderTest.plot("P3"), 3));
		later.start();
		waitUntilBlocked(later);
		assertTrue(gew.isSuperseded());
		gew.release.countDown();
		first.join();
		earlier.join();
		later.join();
		// The newer plot shown, and nothing waits any more
		assertEquals(Arrays.asList("P1", "P3"), gew.shown);
		assertFalse(gew.isSuperseded());
	}

	@Test
	public void nothingWaitingSupersedesNothing() {
		RecordingGoogleEarthWeb gew = new RecordingGoogleEarthWeb();
		assertFalse(gew.isSuperseded());
		gew.showPlot(PlotSelectionOrderTest.plot("P1"), 1);
		assertFalse(gew.isSuperseded());
	}

	@Test
	@Timeout(10)
	public void theSameSelectionAgainDoesNotSupersedeIt() throws Exception {
		List<Boolean> seen = Collections.synchronizedList(new ArrayList<>());
		RecordingGoogleEarthWeb gew = new RecordingGoogleEarthWeb();
		CountDownLatch inShow = new CountDownLatch(1);
		gew.inShow = inShow;
		gew.release = new CountDownLatch(1);
		Thread first = new Thread(() -> gew.showPlot(PlotSelectionOrderTest.plot("P1"), 1));
		first.start();
		PlotSelectionOrderTest.await(inShow);
		// The imagery window opened again on the plot shown: its own number, the same plot; not newer than the one shown
		Thread again = new Thread(() -> gew.showPlot(PlotSelectionOrderTest.plot("P1"), 1));
		again.start();
		waitUntilBlocked(again);
		seen.add(gew.isSuperseded());
		gew.release.countDown();
		first.join();
		again.join();
		assertEquals(Arrays.asList(false), seen);
	}

	private static void waitUntilBlocked(Thread thread) throws InterruptedException {
		while (thread.getState() != Thread.State.BLOCKED) {
			Thread.sleep(5);
		}
	}
}

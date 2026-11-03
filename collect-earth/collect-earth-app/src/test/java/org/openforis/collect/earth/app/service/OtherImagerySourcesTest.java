package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.openforis.collect.earth.app.service.GoogleEarthWebService.State;
import org.openforis.collect.earth.app.service.PlotSelectionOrderTest.RecordingGoogleEarthWeb;
import org.openforis.collect.earth.app.service.imagery.ImagerySource;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;

/**
 * The sources other than Google Earth Web ({@link PlotImageryService}): they load the plot after Google Earth Web has
 * shown it, and only in a tab the user sees; a hidden tab loads the latest plot when it is shown.
 */
public class OtherImagerySourcesTest {

	/** The sources, recording what each loads and the order of the steps, with the tabs shown and telling it as set. */
	static class Sources extends PlotImageryService {
		final List<String> steps = Collections.synchronizedList(new ArrayList<>());
		final Set<ImagerySource> shown = Collections.synchronizedSet(EnumSet.noneOf(ImagerySource.class));
		/** The sources whose tab tells when it is shown: all of them, unless taken out. */
		final Set<ImagerySource> telling = Collections.synchronizedSet(EnumSet.allOf(ImagerySource.class));

		Sources() {
			async = Runnable::run;
		}

		@Override
		void fillPlot(SimplePlacemarkObject placemark, KmlGenerator kmlGenerator) {
			// nothing to fill
		}

		@Override
		void rememberImageryTabs() {
			// no browser
		}

		@Override
		void awaitGoogleEarthWeb(SimplePlacemarkObject placemark, long selection) {
			steps.add("wait for Google Earth Web " + placemark.getPlacemarkId());
		}

		@Override
		void sendToGoogleEarthWeb(SimplePlacemarkObject placemark, long selection) {
			steps.add("Google Earth Web " + placemark.getPlacemarkId());
		}

		@Override
		void openImageryTabs() {
			steps.add("open the tabs");
		}

		@Override
		void loadInOtherSources(SimplePlacemarkObject placemark, long selection) {
			steps.add("other sources " + placemark.getPlacemarkId());
			super.loadInOtherSources(placemark, selection);
		}

		@Override
		boolean loadsNow(ImagerySource source) {
			return shown.contains(source) || !telling.contains(source);
		}

		@Override
		void loadIn(ImagerySource source, SimplePlacemarkObject placemark, long selection) {
			steps.add(source + " " + placemark.getPlacemarkId());
		}

		List<String> loads() {
			List<String> loads = new ArrayList<>();
			for (String step : steps) {
				for (ImagerySource source : ImagerySource.values()) {
					if (step.startsWith(source + " ")) {
						loads.add(step);
					}
				}
			}
			return loads;
		}
	}

	@Test
	public void theOtherSourcesOpenTheirTabsAndLoadOnlyAfterGoogleEarthWeb() {
		Sources sources = new Sources();
		sources.shown.add(ImagerySource.ESRI_WAYBACK);
		sources.showPlot(PlotSelectionOrderTest.plot("A"), null);
		assertEquals(Arrays.asList("Google Earth Web A", "wait for Google Earth Web A", "open the tabs", "other sources A",
				"ESRI_WAYBACK A"), sources.steps);
	}

	@Test
	public void onlyTheSourceShownLoadsAndAHiddenOneLoadsTheLatestPlotWhenShown() {
		Sources sources = new Sources();
		sources.shown.add(ImagerySource.ESRI_WAYBACK);
		sources.showPlot(PlotSelectionOrderTest.plot("A"), null);
		sources.showPlot(PlotSelectionOrderTest.plot("B"), null);
		assertEquals(Arrays.asList("ESRI_WAYBACK A", "ESRI_WAYBACK B"), sources.loads());
		// The user shows Earth Map: it loads B, not A
		sources.shown.add(ImagerySource.EARTH_MAP);
		sources.sourceShown(ImagerySource.EARTH_MAP);
		assertEquals(Arrays.asList("ESRI_WAYBACK A", "ESRI_WAYBACK B", "EARTH_MAP B"), sources.loads());
		// Shown again with no plot since: nothing to load
		sources.sourceShown(ImagerySource.EARTH_MAP);
		assertEquals(3, sources.loads().size());
	}

	@Test
	public void aTabThatCannotTellWhenItIsShownLoadsAtOnce() {
		Sources sources = new Sources();
		// Never loaded (the blank tab it opened with): no word would come when the user shows it
		sources.telling.remove(ImagerySource.GEE_APP);
		sources.showPlot(PlotSelectionOrderTest.plot("A"), null);
		assertEquals(Arrays.asList("GEE_APP A"), sources.loads());
	}

	@Test
	public void aPlotLoadedSinceInTheShownTabIsNotLoadedAgainWhenItIsShownLater() {
		Sources sources = new Sources();
		sources.showPlot(PlotSelectionOrderTest.plot("A"), null); // Planet hidden: kept
		sources.shown.add(ImagerySource.PLANET);
		sources.showPlot(PlotSelectionOrderTest.plot("B"), null); // Planet shown: loaded
		sources.shown.remove(ImagerySource.PLANET);
		sources.sourceShown(ImagerySource.PLANET); // shown again, nothing kept
		assertEquals(Arrays.asList("PLANET B"), sources.loads());
	}

	@Test
	public void aPlotGoneByWhileGoogleEarthWebShowedItLoadsNothingInTheOtherSources() {
		Sources sources = new Sources() {
			@Override
			void awaitGoogleEarthWeb(SimplePlacemarkObject placemark, long selection) {
				super.awaitGoogleEarthWeb(placemark, selection);
				if ("A".equals(placemark.getPlacemarkId())) {
					showPlot(PlotSelectionOrderTest.plot("B"), null); // B selected while A was shown
				}
			}
		};
		sources.shown.add(ImagerySource.ESRI_WAYBACK);
		sources.showPlot(PlotSelectionOrderTest.plot("A"), null);
		assertEquals(Arrays.asList("ESRI_WAYBACK B"), sources.loads());
	}

	@Test
	@Timeout(10)
	public void googleEarthWebIsAwaitedUntilItShowedThePlot() throws Exception {
		RecordingGoogleEarthWeb gew = new RecordingGoogleEarthWeb();
		gew.setState(State.MOVING, "A", null);
		Thread ready = new Thread(() -> {
			sleep(200);
			gew.setState(State.READY, "A", null);
		});
		ready.start();
		long start = System.nanoTime();
		gew.awaitShown("A", 5000, () -> false);
		long waited = (System.nanoTime() - start) / 1_000_000;
		ready.join();
		assertTrue(waited >= 150 && waited < 4000, waited + " ms");
	}

	@Test
	@Timeout(10)
	public void googleEarthWebStillOnThePlotBeforeIsAwaitedToo() throws Exception {
		RecordingGoogleEarthWeb gew = new RecordingGoogleEarthWeb();
		// READY, but for the plot before: its thread has not started on A yet
		gew.setState(State.READY, "Z", null);
		long start = System.nanoTime();
		gew.awaitShown("A", 300, () -> false);
		assertTrue((System.nanoTime() - start) / 1_000_000 >= 250);
		// Given up on, or waiting for the user: done with the plot too
		gew.setState(State.WAITING, "A", null);
		start = System.nanoTime();
		gew.awaitShown("A", 3000, () -> false);
		assertTrue((System.nanoTime() - start) / 1_000_000 < 1000);
	}

	@Test
	@Timeout(10)
	public void theWaitForGoogleEarthWebEndsWithItsTimeOrWhenTold() throws Exception {
		RecordingGoogleEarthWeb gew = new RecordingGoogleEarthWeb();
		gew.setState(State.OPENING, "A", null);
		long start = System.nanoTime();
		gew.awaitShown("A", 300, () -> false);
		long waited = (System.nanoTime() - start) / 1_000_000;
		assertTrue(waited >= 250 && waited < 3000, waited + " ms");
		start = System.nanoTime();
		gew.awaitShown("A", 5000, () -> true); // a newer plot selected
		assertTrue((System.nanoTime() - start) / 1_000_000 < 1000);
	}

	private static void sleep(long millis) {
		try {
			Thread.sleep(millis);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}
}

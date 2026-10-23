package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.Test;

public class PlotsMapReopeningTest {

	private final AtomicLong now = new AtomicLong(1_000);
	private final PlotsMapReopening reopening = new PlotsMapReopening(now::get, Duration.ofNanos(30));

	@Test
	public void notBeforeTheMapWasOpened() {
		assertFalse(reopening.shouldCheck(true, false));
	}

	@Test
	public void onceOpenedItIsKeptOpen() {
		reopening.opened();
		assertTrue(reopening.shouldCheck(true, false));
	}

	@Test
	public void notWithTheClassicViewer() {
		reopening.opened();
		assertFalse(reopening.shouldCheck(false, false));
	}

	@Test
	public void notWhileCollectEarthCloses() {
		reopening.opened();
		assertFalse(reopening.shouldCheck(true, true));
	}

	@Test
	public void aFailedReopenIsNotTriedAgainForAWhile() {
		reopening.opened();
		reopening.failed();
		now.addAndGet(29);
		assertFalse(reopening.shouldCheck(true, false));
		now.addAndGet(1);
		assertTrue(reopening.shouldCheck(true, false));
	}

	@Test
	public void onlyTheFirstFailureInARowIsWarnedAbout() {
		reopening.opened();
		assertTrue(reopening.failed());
		now.addAndGet(30);
		assertFalse(reopening.failed());
		reopening.opened();
		assertTrue(reopening.failed());
	}

	@Test
	public void aWindowIsReopenedOnlyOnceTwoChecksInARowFoundItClosed() {
		reopening.opened();
		// A browser that answers oddly once must not get a live window, and its form, reloaded
		assertFalse(reopening.foundClosed());
		reopening.foundOpen();
		assertFalse(reopening.foundClosed());
		assertTrue(reopening.foundClosed());
	}

	@Test
	public void aReopenStartsTheCountAgain() {
		reopening.opened();
		reopening.foundClosed();
		assertTrue(reopening.foundClosed());
		reopening.opened();
		assertFalse(reopening.foundClosed());
	}

	@Test
	public void aWindowOpenedMeanwhileEndsTheBackOff() {
		reopening.opened();
		reopening.failed();
		reopening.opened(); // e.g. the user chose Arrange, and the browser started this time
		assertTrue(reopening.shouldCheck(true, false));
	}
}

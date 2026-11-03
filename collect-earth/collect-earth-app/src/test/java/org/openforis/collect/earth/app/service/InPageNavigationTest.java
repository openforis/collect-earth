package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * What says that Google Earth Web followed an in-page navigation, and when it is given up on ({@link InPageNavigation}):
 * never on one failure, never on a failure that says nothing, and tried again after some page loads.
 */
public class InPageNavigationTest {

	private static final String PUSHED = GoogleEarthWebUrls.cameraUrl("15.972537", "-16.325393", 0, 128);

	@Test
	public void theDataSuffixGoogleEarthWebAppendsSaysItFollowed() {
		assertTrue(InPageNavigation.isFollowed(PUSHED, PUSHED + "/data=CgRCAggB", false, 15.972537, -16.325393));
	}

	@Test
	public void aCameraGoogleEarthWebWroteOverThePlotSaysItFollowed() {
		String arrived = PUSHED.replace(",128d,", ",128.00453096d,");
		assertTrue(InPageNavigation.isFollowed(PUSHED, arrived, false, 15.972537, -16.325393));
	}

	@Test
	public void theUrlPushedUntouchedSaysItFollowedOnlyWhenGoogleEarthWebJumps() {
		assertFalse(InPageNavigation.isFollowed(PUSHED, PUSHED, false, 15.972537, -16.325393));
		assertTrue(InPageNavigation.isFollowed(PUSHED, PUSHED, true, 15.972537, -16.325393));
	}

	@Test
	public void aCameraElsewhereSaysNothingFollowed() {
		// Where the camera was before, or the globe Google Earth Web resets to while it starts
		String before = GoogleEarthWebUrls.cameraUrl("15.956562", "-15.99616", 0, 128) + "/data=CgRCAggB";
		assertFalse(InPageNavigation.isFollowed(PUSHED, before, true, 15.972537, -16.325393));
		assertFalse(InPageNavigation.isFollowed(PUSHED, "https://earth.google.com/web/@0,0,0a,22251752.77375655d,35y,0h,0t,0r",
				true, 15.972537, -16.325393));
		assertFalse(InPageNavigation.isFollowed(PUSHED, null, true, 15.972537, -16.325393));
	}

	@Test
	public void oneFailureIsNotEnoughToGiveUp() {
		InPageNavigation inPage = new InPageNavigation();
		assertNull(inPage.follows());
		assertFalse(inPage.notFollowed(true));
		assertTrue(inPage.worthTrying());
		assertFalse(inPage.notFollowed(true));
		assertTrue(inPage.worthTrying());
		assertTrue(inPage.notFollowed(true));
		assertEquals(Boolean.FALSE, inPage.follows());
		assertFalse(inPage.worthTrying());
	}

	@Test
	public void failuresThatSayNothingAreNotCounted() {
		InPageNavigation inPage = new InPageNavigation();
		for (int i = 0; i < 10; i++) {
			assertFalse(inPage.notFollowed(false)); // hidden, or the imagery window busy opening tabs
		}
		assertTrue(inPage.worthTrying());
	}

	@Test
	public void theFailuresMustComeInARow() {
		InPageNavigation inPage = new InPageNavigation();
		inPage.notFollowed(true);
		inPage.notFollowed(true);
		inPage.followed();
		assertEquals(Boolean.TRUE, inPage.follows());
		assertFalse(inPage.notFollowed(true));
		assertFalse(inPage.notFollowed(true));
		assertTrue(inPage.worthTrying());
	}

	@Test
	public void givenUpItIsTriedAgainAfterSomePageLoadsAndGivenUpAgainOnTheNextFailure() {
		InPageNavigation inPage = new InPageNavigation();
		for (int i = 0; i < InPageNavigation.FAILURES_TO_GIVE_UP; i++) {
			inPage.notFollowed(true);
		}
		for (int i = 1; i < InPageNavigation.PAGE_LOADS_TO_TRY_AGAIN; i++) {
			inPage.pageLoaded();
			assertFalse(inPage.worthTrying());
		}
		inPage.pageLoaded();
		assertTrue(inPage.worthTrying());
		assertNull(inPage.follows());
		assertTrue(inPage.notFollowed(true));
		assertFalse(inPage.worthTrying());
	}

	@Test
	public void pageLoadsChangeNothingWhileItIsNotGivenUp() {
		InPageNavigation inPage = new InPageNavigation();
		inPage.notFollowed(true);
		for (int i = 0; i < 2 * InPageNavigation.PAGE_LOADS_TO_TRY_AGAIN; i++) {
			inPage.pageLoaded();
		}
		assertFalse(inPage.notFollowed(true));
		assertTrue(inPage.notFollowed(true));
	}
}

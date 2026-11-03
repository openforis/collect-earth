package org.openforis.collect.earth.app.service;

/**
 * Whether Google Earth Web follows in-page navigation (a camera URL pushed onto the history, see
 * {@link GoogleEarthWebService}), as learnt from the plots shown: null until known.
 * <p>
 * One plot that did not move says little: the first one was measured failing while the worker of the imagery window
 * was opening the tabs of the other sources, each holding up the reads of the URL for seconds, in a Google Earth Web that
 * followed a push in 84 ms right after. Taking that as "never" made every plot after it a page load of 5 to 6 s, and
 * took away the camera following the plots map. So it is given up on only after {@link #FAILURES_TO_GIVE_UP} fair
 * failures in a row (the tab shown throughout, no tab opened meanwhile), and tried again after
 * {@link #PAGE_LOADS_TO_TRY_AGAIN} page loads, as Google Earth Web may have changed since.
 */
final class InPageNavigation {

	static final int FAILURES_TO_GIVE_UP = 3;
	static final int PAGE_LOADS_TO_TRY_AGAIN = 10;

	private Boolean follows;
	/** The fair failures since the last success. */
	private int failures;
	/** The page loads since it was given up on. */
	private int pageLoads;

	/**
	 * Whether the URL read from the tab says Google Earth Web followed the push of {@code pushedUrl}: its camera over the
	 * target. Google Earth Web appends its {@code /data=} suffix at once when it takes the push, and keeps the camera
	 * pushed for the whole flight; with its animations turned off it writes nothing (see {@code jumps} in
	 * javascript_google_earth_web.fmt), so the URL pushed, untouched, is taken as followed when Google Earth Web is known
	 * to jump.
	 *
	 * @param jumps whether the page remembers that Google Earth Web jumps ({@code __collectEarthGewJumps})
	 */
	static boolean isFollowed(String pushedUrl, String href, boolean jumps, double latitude, double longitude) {
		if (href == null || !GoogleEarthWebUrls.isCameraAt(href, latitude, longitude)) {
			return false;
		}
		return !href.equals(pushedUrl) || href.contains("/data=") || jumps;
	}

	/** True, false, or null while not known. */
	synchronized Boolean follows() {
		return follows;
	}

	/** Whether to try in-page navigation for the next plot: unless given up on. */
	synchronized boolean worthTrying() {
		return !Boolean.FALSE.equals(follows);
	}

	synchronized void followed() {
		follows = Boolean.TRUE;
		failures = 0;
	}

	/**
	 * An in-page navigation that Google Earth Web did not follow in time.
	 *
	 * @param fair whether it says anything: the tab was shown throughout (a hidden Google Earth Web may not fly until it
	 *             is shown), no tab was opened meanwhile, and the URL could be read
	 * @return whether it is now given up on
	 */
	synchronized boolean notFollowed(boolean fair) {
		if (!fair || Boolean.FALSE.equals(follows)) {
			return false;
		}
		if (++failures < FAILURES_TO_GIVE_UP) {
			return false;
		}
		follows = Boolean.FALSE;
		pageLoads = 0;
		return true;
	}

	/**
	 * A plot was shown with a page load. Once given up on, after {@link #PAGE_LOADS_TO_TRY_AGAIN} of them it is tried
	 * again, and one more fair failure gives it up again.
	 */
	synchronized void pageLoaded() {
		if (Boolean.FALSE.equals(follows) && ++pageLoads >= PAGE_LOADS_TO_TRY_AGAIN) {
			follows = null;
			failures = FAILURES_TO_GIVE_UP - 1;
		}
	}
}

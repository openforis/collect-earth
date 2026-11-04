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
	/**
	 * After this many failures in a row that said nothing, it is not tried again until the tab is seen shown
	 * ({@link #seen()}): a tab hidden throughout cost 4 s on every plot, for nothing learnt.
	 */
	static final int UNFAIR_FAILURES_TO_PAUSE = 3;

	private Boolean follows;
	/** The fair failures since the last success. */
	private int failures;
	/** The page loads since it was given up on. */
	private int pageLoads;
	/** The failures that said nothing since the last one that did, the last success or the tab last seen. */
	private int unfairFailures;

	/**
	 * Whether the URL read from the tab says Google Earth Web followed the push of {@code pushedUrl}: its camera over the
	 * target. Google Earth Web appends its {@code /data=} suffix when it takes the push (seen 0.04 to 0.85 s after it,
	 * its fly animation on or off), and keeps the camera pushed for the whole flight; with its animation off it writes
	 * no camera of its own, so the URL pushed, untouched, is taken as followed when Google Earth Web jumps.
	 *
	 * @param jumps whether Google Earth Web jumps to a camera sent, as the overlay decides it ({@code GewCamera.jumpsNow}
	 *              in javascript_google_earth_web_camera.js, see {@link GoogleEarthWebService#inPageProbeScript()})
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

	/**
	 * Whether Google Earth Web may follow in-page navigation: unless given up on. The camera then follows the plots map.
	 */
	synchronized boolean mayFollow() {
		return !Boolean.FALSE.equals(follows);
	}

	/**
	 * Whether to try in-page navigation for the next plot: unless given up on, or paused after failures that said
	 * nothing (see {@link #UNFAIR_FAILURES_TO_PAUSE}).
	 */
	synchronized boolean worthTrying() {
		return mayFollow() && unfairFailures < UNFAIR_FAILURES_TO_PAUSE;
	}

	/** The tab was seen shown: a pause after failures that said nothing is over. */
	synchronized void seen() {
		unfairFailures = 0;
	}

	synchronized void followed() {
		follows = Boolean.TRUE;
		failures = 0;
		unfairFailures = 0;
	}

	/**
	 * An in-page navigation that Google Earth Web did not follow in time.
	 *
	 * @param fair whether it says anything: the tab was shown throughout (a hidden Google Earth Web may not fly until it
	 *             is shown), no tab was opened meanwhile, and the URL could be read
	 * @return whether it is now given up on
	 */
	synchronized boolean notFollowed(boolean fair) {
		if (!fair) {
			unfairFailures++;
			return false;
		}
		unfairFailures = 0;
		if (Boolean.FALSE.equals(follows)) {
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

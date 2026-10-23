package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Which requests {@link OwnPagesOnlyFilter} lets through to the imagery and Google Earth Web endpoints. */
public class OwnPagesOnlyFilterTest {

	private static boolean allowed(String secFetchSite, String origin, String host) {
		return OwnPagesOnlyFilter.isFromOwnPage(secFetchSite, origin, "http", host);
	}

	@Test
	public void thePlotsMapIsLetThrough() {
		// Its GET fetches: same origin, no Origin header
		assertTrue(allowed("same-origin", null, "127.0.0.1:8028"));
		// Its POST of the neighbours: its own origin
		assertTrue(allowed("same-origin", "http://127.0.0.1:8028", "127.0.0.1:8028"));
		assertTrue(allowed("same-origin", "http://localhost:8028", "LOCALHOST:8028"));
		// npm run dev: the page on Vite's server, which passes the requests on with their Host
		assertTrue(allowed("same-origin", "http://localhost:5173", "localhost:5173"));
	}

	@Test
	public void aRequestNotFromAPageIsLetThrough() {
		assertTrue(allowed(null, null, "127.0.0.1:8028"));
		assertTrue(allowed(null, null, null));
		// An address typed or opened by the user
		assertTrue(allowed("none", null, "127.0.0.1:8028"));
	}

	@Test
	public void anotherSiteIsRefused() {
		// An image or a no-cors fetch: no Origin
		assertFalse(allowed("cross-site", null, "127.0.0.1:8028"));
		assertFalse(allowed("Cross-Site", null, "127.0.0.1:8028"));
		assertFalse(allowed("cross-site", "https://example.com", "127.0.0.1:8028"));
		// A browser that does not send Sec-Fetch-Site, on a cross-origin request
		assertFalse(allowed(null, "https://example.com", "127.0.0.1:8028"));
		// Same site, another origin (another port of the same host)
		assertFalse(allowed("same-site", "http://127.0.0.1:9000", "127.0.0.1:8028"));
		// A sandboxed frame or a file
		assertFalse(allowed(null, "null", "127.0.0.1:8028"));
		assertFalse(allowed(null, "http://127.0.0.1:8028", null));
	}
}

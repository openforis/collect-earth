package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Which requests {@link OwnPagesOnlyFilter} lets through to the imagery and Google Earth Web endpoints. */
public class OwnPagesOnlyFilterTest {

	private static final String CONFIGURED = "127.0.0.1";

	private static boolean allowed(String secFetchSite, String origin, String host) {
		return OwnPagesOnlyFilter.isFromOwnPage(secFetchSite, origin, "http", host, CONFIGURED);
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
		// A sandboxed frame or a file
		assertFalse(allowed(null, "null", "127.0.0.1:8028"));
	}

	@Test
	public void anotherProgramOnThisComputerIsRefused() {
		// A page of another program on another port of localhost is the same site: an image sends no Origin
		assertFalse(allowed("same-site", null, "127.0.0.1:8028"));
		assertFalse(allowed("same-site", "http://127.0.0.1:9000", "127.0.0.1:8028"));
		assertFalse(allowed("same-origin-ish", null, "127.0.0.1:8028"));
	}

	@Test
	public void onlyThisComputersNamesAndTheConfiguredHostAreTakenForThisServer() {
		assertTrue(allowed(null, null, "localhost"));
		assertTrue(allowed(null, null, "localhost:8028"));
		assertTrue(allowed(null, null, "127.0.0.1"));
		assertTrue(allowed("same-origin", "http://[::1]:8028", "[::1]:8028"));
		assertTrue(allowed(null, null, "[::1]"));
		// The host Collect Earth is configured with (another computer's address, in client mode)
		assertTrue(OwnPagesOnlyFilter.isFromOwnPage("same-origin", null, "http", "192.168.1.20:8028", "192.168.1.20"));
		assertTrue(OwnPagesOnlyFilter.isFromOwnPage(null, null, "http", "Server.Local:8028", "server.local"));
		// DNS rebinding: a site's name pointed to 127.0.0.1, same origin for the browser
		assertFalse(allowed("same-origin", null, "evil.example:8028"));
		assertFalse(allowed("same-origin", "http://evil.example:8028", "evil.example:8028"));
		assertFalse(allowed(null, null, "localhost.evil.example:8028"));
		assertFalse(allowed(null, null, "[::2]:8028"));
		assertFalse(allowed(null, null, "192.168.1.20:8028"));
		assertFalse(OwnPagesOnlyFilter.isFromOwnPage(null, null, "http", "192.168.1.20:8028", null));
		assertFalse(OwnPagesOnlyFilter.isFromOwnPage(null, null, "http", "192.168.1.20:8028", " "));
		// No Host at all
		assertFalse(allowed(null, null, null));
	}

	@Test
	public void theNameOfAHostIsWithoutItsPort() {
		assertEquals("localhost", OwnPagesOnlyFilter.hostname("LocalHost:8028"));
		assertEquals("127.0.0.1", OwnPagesOnlyFilter.hostname("127.0.0.1"));
		assertEquals("[::1]", OwnPagesOnlyFilter.hostname("[::1]:8028"));
		assertEquals("[::1]", OwnPagesOnlyFilter.hostname("[::1]"));
	}
}

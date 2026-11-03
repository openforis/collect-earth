package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** How the browser keeps the plots map, the web form and the files they load ({@link HttpCaching}). */
public class HttpCachingTest {

	private static final byte[] PAGE = "<html>form</html>".getBytes(StandardCharsets.UTF_8);

	@Test
	public void theFilesNamedByTheirContentAreKeptAYear() {
		for (String file : new String[] { "form-BBM79X7o.js", "map-BMdOtu4D.js", "map-vh-t_kPv.css", "shortcuts-D42rdgNv.js",
				"collect-earth-logo-Cm2Zex6a.png", "roboto-latin-400-normal-BqEyEoaF.woff2", "roboto-vietnamese-500-normal-BgoYVz-9.woff" }) {
			assertEquals("public, max-age=31536000, immutable", HttpCaching.cacheControlFor(file), file);
		}
	}

	@Test
	public void theOtherFilesAreAskedForAgain() {
		for (String file : new String[] { "map.html", "form.html", "form-BBM79X7o.html", "leaflet.js", "marker-icon.png",
				"layers-2x.png", "index.js", "a-b.js" }) {
			assertEquals("no-cache", HttpCaching.cacheControlFor(file), file);
		}
	}

	@Test
	public void aFileKeptAYearIsSentWithoutAnETag() throws Exception {
		MockHttpServletRequest request = new MockHttpServletRequest();
		request.addHeader("If-None-Match", "*");
		MockHttpServletResponse response = new MockHttpServletResponse();
		HttpCaching.send(request, response, PAGE, "application/javascript", HttpCaching.IMMUTABLE, null);

		assertEquals(200, response.getStatus());
		assertNull(response.getHeader("ETag"));
		assertArrayEquals(PAGE, response.getContentAsByteArray());
	}

	@Test
	public void aPageIsSentWithItsETagThenAnswered304WhileUnchanged() throws Exception {
		MockHttpServletResponse first = new MockHttpServletResponse();
		HttpCaching.send(new MockHttpServletRequest(), first, PAGE, "text/html; charset=UTF-8", HttpCaching.REVALIDATE, null);
		String etag = first.getHeader("ETag");
		assertEquals(200, first.getStatus());
		assertEquals("no-cache", first.getHeader("Cache-Control"));
		assertTrue(etag.startsWith("\"") && etag.endsWith("\""));
		assertEquals("text/html; charset=UTF-8", first.getHeader("Content-Type"));
		assertArrayEquals(PAGE, first.getContentAsByteArray());

		MockHttpServletRequest again = new MockHttpServletRequest();
		again.addHeader("If-None-Match", etag);
		MockHttpServletResponse second = new MockHttpServletResponse();
		HttpCaching.send(again, second, PAGE, "text/html; charset=UTF-8", HttpCaching.REVALIDATE, null);
		assertEquals(304, second.getStatus());
		assertEquals(0, second.getContentAsByteArray().length);
		assertEquals(etag, second.getHeader("ETag"));
	}

	@Test
	public void aChangedPageIsSentAgain() throws Exception {
		String old = HttpCaching.etag(PAGE);
		byte[] changed = "<html>form 2</html>".getBytes(StandardCharsets.UTF_8);
		assertNotEquals(old, HttpCaching.etag(changed));

		MockHttpServletRequest request = new MockHttpServletRequest();
		request.addHeader("If-None-Match", old);
		MockHttpServletResponse response = new MockHttpServletResponse();
		HttpCaching.send(request, response, changed, "text/html", HttpCaching.REVALIDATE, null);
		assertEquals(200, response.getStatus());
		assertArrayEquals(changed, response.getContentAsByteArray());
	}

	@Test
	public void theETagsOfTheRequestAreRead() {
		String etag = HttpCaching.etag(PAGE);
		assertTrue(HttpCaching.matches(etag, etag));
		assertTrue(HttpCaching.matches("\"other\", W/" + etag, etag));
		assertTrue(HttpCaching.matches("*", etag));
		assertFalse(HttpCaching.matches("\"other\"", etag));
		assertFalse(HttpCaching.matches(null, etag));
	}
}

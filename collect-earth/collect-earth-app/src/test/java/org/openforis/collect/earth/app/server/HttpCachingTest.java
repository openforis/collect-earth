package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** How the browser keeps the plots map, the web form and the files they load ({@link HttpCaching}). */
public class HttpCachingTest {

	private static final byte[] PAGE = "<html>form</html>".getBytes(StandardCharsets.UTF_8);

	/** The shape of the manifest Vite writes (build-manifest.json) */
	private static final String MANIFEST = "{"
			+ "\"_shortcuts-C7F_CAKX.js\": {\"file\": \"shortcuts-C7F_CAKX.js\", \"name\": \"shortcuts\","
			+ " \"css\": [\"shortcuts-D9iMP7se.css\"], \"assets\": [\"collect-earth-logo-Cm2Zex6a.png\","
			+ " \"roboto-vietnamese-500-normal-BgoYVz-9.woff\"]},"
			+ "\"form.html\": {\"file\": \"form-BBM79X7o.js\", \"src\": \"form.html\", \"isEntry\": true,"
			+ " \"imports\": [\"_shortcuts-C7F_CAKX.js\"]},"
			+ "\"map.html\": {\"file\": \"map-vh-t_kPv.js\", \"src\": \"map.html\", \"isEntry\": true},"
			+ "\"src/form/collect-earth-logo.png\": {\"file\": \"collect-earth-logo-Cm2Zex6a.png\", \"src\": \"src/form/collect-earth-logo.png\"}"
			+ "}";

	private static Set<String> built() {
		return HttpCaching.builtFiles(new ByteArrayInputStream(MANIFEST.getBytes(StandardCharsets.UTF_8)));
	}

	@Test
	public void theManifestListsTheFilesOfTheBuild() {
		assertEquals(new HashSet<>(Arrays.asList("shortcuts-C7F_CAKX.js", "shortcuts-D9iMP7se.css", "collect-earth-logo-Cm2Zex6a.png",
				"roboto-vietnamese-500-normal-BgoYVz-9.woff", "form-BBM79X7o.js", "map-vh-t_kPv.js")), built());
		assertEquals(Collections.emptySet(), HttpCaching.builtFiles(null));
		assertEquals(Collections.emptySet(), HttpCaching.builtFiles(new ByteArrayInputStream("not json".getBytes(StandardCharsets.UTF_8))));
	}

	@Test
	public void theFilesOfTheBuildAreKeptAYear() {
		for (String file : built()) {
			assertEquals("public, max-age=31536000, immutable", HttpCaching.cacheControlFor(file, built()), file);
		}
	}

	@Test
	public void theOtherFilesAreAskedForAgain() {
		// pages; names that look like those of the build and are not in it
		for (String file : new String[] { "map.html", "form.html", "build-manifest.json", "leaflet-markercl.js",
				"shortcuts-D42rdgNv.js", "layers-2x.png", "index.js" }) {
			assertEquals("no-cache", HttpCaching.cacheControlFor(file, built()), file);
		}
		// no manifest: nothing is kept
		assertEquals("no-cache", HttpCaching.cacheControlFor("form-BBM79X7o.js", Collections.emptySet()));
	}

	@Test
	public void aNameCarriesAHashOfViteOnly() {
		assertTrue(HttpCaching.isContentHashed("map-vh-t_kPv.css"));
		assertFalse(HttpCaching.isContentHashed("form-BBM79X7o.html"));
		assertFalse(HttpCaching.isContentHashed("form-BBM79X7.js"));
		assertFalse(HttpCaching.isContentHashed("form-BBM79X7o!.js"));
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

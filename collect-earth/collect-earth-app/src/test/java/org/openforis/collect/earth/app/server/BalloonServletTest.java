package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Collections;

import org.junit.jupiter.api.Test;

/** The request's values the balloon is filled with cannot add markup or script to it. */
public class BalloonServletTest {

	private static String fill(String template, String key, String value) {
		return BalloonServlet.replaceGoalsWithParameters(template, Collections.singletonMap(key, new String[] { value }));
	}

	@Test
	public void plotIdsAndAddressesAreKeptAsTheyAre() {
		assertEquals("var PLACEMARK_ID = \"105,2,Área\";", fill("var PLACEMARK_ID = \"$[id]\";", "id", "105,2,Área"));
		assertEquals("<input value=\"http://127.0.0.1:8028/earth/\">",
				fill("<input value=\"$[host]\">", "host", "http://127.0.0.1:8028/earth/"));
	}

	@Test
	public void markupAndScriptAreEscaped() {
		assertEquals("<span>&lt;script&gt;alert(1)&lt;/script&gt;</span>",
				fill("<span>$[id]</span>", "id", "<script>alert(1)</script>"));
		// a JavaScript string cannot be ended, with a quote or with a backslash before the closing one
		assertEquals("var ID = \"&quot;;alert(1)//\";", fill("var ID = \"$[id]\";", "id", "\";alert(1)//"));
		assertEquals("var ID = \"&#92;\";", fill("var ID = \"$[id]\";", "id", "\\"));
		assertEquals("url('&#39;)')", fill("url('$[host]')", "host", "')"));
		assertEquals("a&amp;b", fill("$[id]", "id", "a&b"));
	}
}

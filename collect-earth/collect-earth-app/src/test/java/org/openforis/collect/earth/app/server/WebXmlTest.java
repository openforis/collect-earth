package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/** The endpoints that act or answer with the plots' data are guarded by OwnPagesOnlyFilter, ahead of cross-origin. */
public class WebXmlTest {

	private static final String OWN_PAGES = "ownPagesOnlyFilter";
	private static final String OWN_PAGES_OR_GEP = "ownPagesOrGoogleEarthProFilter";

	private static String child(Element element, String name) {
		return element.getElementsByTagName(name).item(0).getTextContent().trim();
	}

	@Test
	public void theGuardCoversTheEndpointsAndComesBeforeCrossOrigin() throws Exception {
		Document webXml;
		try (InputStream in = WebXmlTest.class.getResourceAsStream("/WEB-INF/web.xml")) {
			webXml = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(in);
		}
		List<String> order = new ArrayList<>();
		Map<String, List<String>> patterns = new HashMap<>();
		NodeList mappings = webXml.getElementsByTagName("filter-mapping");
		for (int i = 0; i < mappings.getLength(); i++) {
			Element mapping = (Element) mappings.item(i);
			String name = child(mapping, "filter-name");
			order.add(name);
			NodeList urls = mapping.getElementsByTagName("url-pattern");
			for (int j = 0; j < urls.getLength(); j++) {
				patterns.computeIfAbsent(name, n -> new ArrayList<>()).add(urls.item(j).getTextContent().trim());
			}
		}
		for (String pattern : new String[] { "/api/*", "/googleEarthWeb/*", "/imagery/*", "/balloon", "/plotsGeoJson",
				"/plotStatuses", "/surveyForm/*" }) {
			assertTrue(patterns.get(OWN_PAGES).contains(pattern), pattern);
		}
		for (String pattern : new String[] { "/openInBrowser", "/placemark-info-expanded", "/save-data-expanded",
				"/create-entity", "/delete-entity", "/plot-activity" }) {
			assertTrue(patterns.get(OWN_PAGES_OR_GEP).contains(pattern), pattern);
		}
		// before googleEarthHeaderFilter, which answers "*" for a missing Origin, and before cross-origin
		for (String guard : new String[] { OWN_PAGES, OWN_PAGES_OR_GEP }) {
			assertTrue(order.indexOf(guard) < order.indexOf("googleEarthHeaderFilter"), guard);
			assertTrue(order.indexOf(guard) < order.indexOf("cross-origin"), guard);
		}

		boolean googleEarthProMode = false;
		NodeList filters = webXml.getElementsByTagName("filter");
		for (int i = 0; i < filters.getLength(); i++) {
			Element filter = (Element) filters.item(i);
			if (OWN_PAGES_OR_GEP.equals(child(filter, "filter-name"))) {
				googleEarthProMode = OwnPagesOnlyFilter.ALLOW_GOOGLE_EARTH_PRO.equals(child(filter, "param-name"))
						&& "true".equals(child(filter, "param-value"));
			}
		}
		assertTrue(googleEarthProMode);
	}
}

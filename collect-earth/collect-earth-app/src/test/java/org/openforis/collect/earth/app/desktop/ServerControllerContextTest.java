package org.openforis.collect.earth.app.desktop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.File;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.xpath.XPathFactory;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.w3c.dom.Document;

/** The generated application context stays valid XML whatever the folder and the password hold. */
public class ServerControllerContextTest {

	@Test
	public void ampersandsAndQuotesAreEscaped(@TempDir Path folder) throws Exception {
		String url = "jdbc:sqlite:C:\\Users\\Romeo&Giulietta\\collectEarth\\db";
		String password = "p&ss\"<word>'";
		Map<String, String> data = new HashMap<>();
		data.put("driver", "org.sqlite.JDBC");
		data.put("url", url);
		data.put("urlIpcc", url + "Ipcc");
		data.put("username", "R&G");
		data.put("password", password);
		data.put("maxTotal", "1");
		data.put("collectEarthExecutionFolder", "C:\\Romeo&Giulietta\\");
		File xml = folder.resolve("generated/applicationContext.xml").toFile();

		// The path is relative to the module folder, which Surefire runs the tests in
		ServerController.writeApplicationContext(new File("resources/applicationContext.fmt"), xml, data);

		Document document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(xml);
		assertEquals(password, XPathFactory.newInstance().newXPath().evaluate("(//*[local-name()='property'][@name='password'])[1]/@value", document));
		assertEquals(url, XPathFactory.newInstance().newXPath().evaluate("(//*[local-name()='property'][@name='url'])[1]/@value", document));
	}
}

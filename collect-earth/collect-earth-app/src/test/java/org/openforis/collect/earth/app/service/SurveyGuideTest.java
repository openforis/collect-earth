package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

/** The survey's guide: an address the project file carries, the file inside an older project file, the cloud project's. */
public class SurveyGuideTest {

	private static final String ADDRESS = "https://cloud.example.org/guide/327db2ed-beef-439b-993b-916b49bcd8b4/AbC_9-xAbC_9-xAbC_9-x";

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final Map<EarthProperty, String> values = new HashMap<>();
	@TempDir
	File folder;
	private File bundled;
	private SurveyGuide guide;

	@BeforeEach
	public void wire() {
		when(properties.getValue(any(EarthProperty.class))).thenAnswer(call -> values.get(call.getArgument(0)));
		doAnswer(call -> values.put(call.getArgument(0), call.getArgument(1))).when(properties).setValue(any(EarthProperty.class), anyString());
		guide = new SurveyGuide(properties, () -> bundled);
	}

	@Test
	public void anAddressIsWhatABrowserOpens() {
		assertEquals(URI.create(ADDRESS), SurveyGuide.addressOf("  " + ADDRESS + " "));
		assertEquals(URI.create("http://intranet.example/guide.pdf"), SurveyGuide.addressOf("http://intranet.example/guide.pdf"));
		for (String not : new String[] { null, "", "  ", "survey_guide.pdf", "file:///C:/guide.pdf", "javascript:alert(1)", "ftp://example.org/g.pdf", "https://", "https:// a b" }) {
			assertNull(SurveyGuide.addressOf(not), String.valueOf(not));
		}
	}

	@Test
	public void theGuideIsTheAddressOfTheProjectFileOrTheFileInsideAnOlderOne() throws IOException {
		assertFalse(guide.exists());
		assertNull(guide.address());
		assertNull(guide.file());
		// an older project file: survey_guide.pdf inside
		bundled = new File(folder, "survey_guide.pdf");
		assertFalse(guide.exists(), "a file that is not there is no guide");
		Files.write(bundled.toPath(), "%PDF-1.4".getBytes(StandardCharsets.UTF_8));
		assertTrue(guide.exists());
		assertEquals(bundled, guide.file());
		// from 2.0: an address
		values.put(EarthProperty.SURVEY_GUIDE_URL, ADDRESS);
		assertEquals(URI.create(ADDRESS), guide.address());
		bundled = null;
		assertTrue(guide.exists());
		// what is no address is no guide
		values.put(EarthProperty.SURVEY_GUIDE_URL, "survey_guide.pdf");
		assertFalse(guide.exists());
	}

	@Test
	public void takesTheCloudProjectsGuideWhenItChanged() {
		Map<String, String> server = new HashMap<>();
		server.put("survey_guide_url", ADDRESS);
		assertTrue(guide.check(() -> server), "set on the dashboard");
		assertEquals(ADDRESS, values.get(EarthProperty.SURVEY_GUIDE_URL));
		assertFalse(guide.check(() -> server), "the same again changes nothing");
		// taken away on the dashboard
		server.put("survey_guide_url", "");
		assertTrue(guide.check(() -> server));
		assertEquals("", values.get(EarthProperty.SURVEY_GUIDE_URL));
		assertFalse(guide.exists());
	}

	@Test
	public void leavesTheGuideAsItIsWhenTheServerSaysNothingOrCannotBeReached() {
		values.put(EarthProperty.SURVEY_GUIDE_URL, ADDRESS);
		// a server of before the guides answers nothing of it
		assertFalse(guide.check(Collections::emptyMap));
		assertFalse(guide.check(() -> { throw new IOException("offline"); }));
		// nor is something a browser would not open written
		assertFalse(guide.check(() -> Collections.singletonMap("survey_guide_url", "javascript:alert(1)")));
		assertEquals(ADDRESS, values.get(EarthProperty.SURVEY_GUIDE_URL));
		verify(properties, never()).setValue(any(EarthProperty.class), anyString());
	}

	@Test
	public void asksTheServerEveryFewMinutesOnly() {
		int[] asked = { 0 };
		SurveyGuide.AddressSource source = () -> {
			asked[0]++;
			return Collections.emptyMap();
		};
		guide.checkIfDue(1_000_000L, source);
		guide.checkIfDue(1_000_000L + SurveyGuide.CHECK_INTERVAL_MS - 1, source);
		assertEquals(1, asked[0]);
		guide.checkIfDue(1_000_000L + SurveyGuide.CHECK_INTERVAL_MS, source);
		assertEquals(2, asked[0]);
	}
}

package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;

import com.google.gson.Gson;

/**
 * A load or a save that fails answers 500 with a message, which the web form shows as an error of Collect Earth: it
 * answered an empty 200, which the form took for Collect Earth not answering.
 */
public class PlacemarkDataControllerTest {

	/** No data accessor and no survey service: every load and save fails */
	private final PlacemarkDataController controller = new PlacemarkDataController();

	@SuppressWarnings("unchecked")
	private static Map<String, Object> body(MockHttpServletResponse response) throws Exception {
		return new Gson().fromJson(response.getContentAsString(), Map.class);
	}

	@Test
	public void aFailedLoadAnswers500WithAMessage() throws Exception {
		MockHttpServletResponse response = new MockHttpServletResponse();
		controller.placemarkInfoExpanded("105", response);

		assertEquals(500, response.getStatus());
		assertTrue(response.getContentType().startsWith("application/json"));
		assertEquals(Boolean.FALSE, body(response).get("success"));
		assertTrue(body(response).get("message") instanceof String);
	}

	@Test
	public void aFailedSaveAnswers500WithAMessage() throws Exception {
		PlacemarkUpdateRequest request = new PlacemarkUpdateRequest();
		request.setPlacemarkId("105");
		Map<String, String> values = new HashMap<>();
		values.put("collect_code_land_use", "F");
		request.setValues(values);
		MockHttpServletResponse response = new MockHttpServletResponse();
		controller.saveDataExpanded(request, response);

		assertEquals(500, response.getStatus());
		assertEquals(Boolean.FALSE, body(response).get("success"));
		assertEquals("no-store", response.getHeader("Cache-Control"));
	}

	@Test
	public void theMessageIsTheOneOfTheFailure() throws Exception {
		MockHttpServletResponse response = new MockHttpServletResponse();
		PlacemarkDataController.sendError(response, new IllegalStateException("The database is locked"));

		assertEquals(500, response.getStatus());
		assertEquals("The database is locked", body(response).get("message"));
	}

	@Test
	public void anAnswerAlreadyStartedIsLeftAsItIs() throws Exception {
		MockHttpServletResponse response = new MockHttpServletResponse();
		response.getWriter().print("{\"success\":true}");
		response.flushBuffer();
		PlacemarkDataController.sendError(response, new IllegalStateException("late"));

		assertEquals(200, response.getStatus());
		assertEquals("{\"success\":true}", response.getContentAsString());
	}
}

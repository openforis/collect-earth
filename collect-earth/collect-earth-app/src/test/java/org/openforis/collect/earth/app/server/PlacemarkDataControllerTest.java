package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.Messages;
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
		// nothing technical for the collector: the form says it in its own words
		assertEquals("", body(response).get("message"));
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
	public void theHeadersSetBeforeStay() throws Exception {
		MockHttpServletResponse response = new MockHttpServletResponse();
		response.setHeader("Access-Control-Allow-Origin", "*");
		response.getWriter().print("{\"suc");
		PlacemarkDataController.sendError(response);

		assertEquals(500, response.getStatus());
		assertEquals("*", response.getHeader("Access-Control-Allow-Origin"));
		assertEquals("", body(response).get("message"));
	}

	@Test
	public void aRowThatCouldNotBeAddedOrDeletedAnswers500WithJson() throws Exception {
		PlacemarkEntityCreateParams params = new PlacemarkEntityCreateParams();
		params.setPlacemarkId("105");
		params.setEntityName("trees");
		params.setValues(new HashMap<>());

		MockHttpServletResponse added = new MockHttpServletResponse();
		controller.createEntity(params, added);
		assertEquals(500, added.getStatus());
		assertEquals(Boolean.FALSE, body(added).get("success"));

		MockHttpServletResponse deleted = new MockHttpServletResponse();
		controller.deleteEntity(params, deleted);
		assertEquals(500, deleted.getStatus());
		assertEquals(Boolean.FALSE, body(deleted).get("success"));
	}

	@Test
	public void anAnswerAlreadyStartedIsLeftAsItIs() throws Exception {
		MockHttpServletResponse response = new MockHttpServletResponse();
		response.getWriter().print("{\"success\":true}");
		response.flushBuffer();
		PlacemarkDataController.sendError(response);

		assertEquals(200, response.getStatus());
		assertEquals("{\"success\":true}", response.getContentAsString());
	}

	private static PlacemarkUpdateRequest save(String plot) {
		PlacemarkUpdateRequest request = new PlacemarkUpdateRequest();
		request.setPlacemarkId(plot);
		Map<String, String> values = new HashMap<>();
		values.put("collect_code_land_use", "F");
		request.setValues(values);
		return request;
	}

	/** A plot without a name is nobody's: it would not be sent as the person's when they join a cloud project */
	@Test
	public void noPlotIsSavedBeforeThePersonHasAName() throws Exception {
		LocalPropertiesService properties = mock(LocalPropertiesService.class);
		when(properties.getOperator()).thenReturn("  ");
		controller.setProperties(properties);

		MockHttpServletResponse saved = new MockHttpServletResponse();
		controller.saveDataExpanded(save("105"), saved);
		assertEquals(200, saved.getStatus());
		assertEquals(Boolean.FALSE, body(saved).get("success"));
		assertEquals(Messages.getString("PlacemarkDataController.nameFirst"), body(saved).get("message"));

		PlacemarkEntityCreateParams params = new PlacemarkEntityCreateParams();
		params.setPlacemarkId("105");
		params.setEntityName("trees");
		params.setValues(new HashMap<>());
		MockHttpServletResponse added = new MockHttpServletResponse();
		controller.createEntity(params, added);
		assertEquals(Messages.getString("PlacemarkDataController.nameFirst"), body(added).get("message"));

		// in a cloud project the name is the account: signing in is what is asked
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		MockHttpServletResponse cloud = new MockHttpServletResponse();
		controller.saveDataExpanded(save("105"), cloud);
		assertEquals(Messages.getString("PlacemarkDataController.signInFirst"), body(cloud).get("message"));
	}

	@Test
	public void withANameTheSaveGoesOnAndTheTestPlotNeedsNone() throws Exception {
		LocalPropertiesService properties = mock(LocalPropertiesService.class);
		when(properties.getOperator()).thenReturn("Maria Dos");
		controller.setProperties(properties);
		MockHttpServletResponse named = new MockHttpServletResponse();
		controller.saveDataExpanded(save("105"), named);
		assertEquals(500, named.getStatus()); // reaches the (missing) survey service

		when(properties.getOperator()).thenReturn(null);
		MockHttpServletResponse test = new MockHttpServletResponse();
		controller.saveDataExpanded(save("$[id]"), test);
		assertEquals(500, test.getStatus()); // the balloon's test plot is not refused
	}
}

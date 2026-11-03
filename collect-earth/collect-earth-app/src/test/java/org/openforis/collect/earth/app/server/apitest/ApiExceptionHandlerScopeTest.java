package org.openforis.collect.earth.app.server.apitest;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.server.api.ApiExceptionHandler;
import org.openforis.collect.earth.app.server.api.TemplateWiring;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The errors of the other controllers are not the API's business: they fail as they always did. This package is named
 * so that its name starts with the one of the API's, which the advice must not take for one of its subpackages.
 */
public class ApiExceptionHandlerScopeTest {

	@RestController
	static class Elsewhere {
		@GetMapping("/elsewhere")
		public String fail() {
			throw new IllegalStateException("boom");
		}
	}

	@Test
	public void theAdviceDoesNotAnswerForControllersOutsideTheApi() throws Exception {
		MockMvc mvc = TemplateWiring.mockMvc(new Elsewhere(), new ApiExceptionHandler());
		// not handled, so it reaches the servlet container, as before the API existed: no {error: internal}
		Exception thrown = assertThrows(Exception.class, () -> mvc.perform(get("/elsewhere")));
		assertTrue(thrown.getCause() instanceof IllegalStateException, thrown.toString());
	}
}

package org.openforis.collect.earth.app.server.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

public class ApiExceptionHandlerTest {

	@RestController
	static class Failing {
		@GetMapping("/api/expected")
		public String expected() {
			throw new ApiException("project.unreadable", "The project file cannot be read");
		}

		@GetMapping("/api/unexpected")
		public String unexpected() {
			throw new IllegalStateException("boom");
		}
	}

	private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new Failing())
			.setControllerAdvice(new ApiExceptionHandler()).build();

	@Test
	public void anExpectedProblemSaysWhatItIs() throws Exception {
		mvc.perform(get("/api/expected")).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("project.unreadable"))
				.andExpect(jsonPath("$.message").value("The project file cannot be read"));
	}

	@Test
	public void anUnexpectedOneIsAnInternalError() throws Exception {
		mvc.perform(get("/api/unexpected")).andExpect(status().isInternalServerError())
				.andExpect(jsonPath("$.error").value("internal"))
				.andExpect(jsonPath("$.details").value("boom"));
	}
}

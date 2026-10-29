package org.openforis.collect.earth.app.server.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** The errors of the API, as the server's own converters and resolvers write them (see TemplateWiring). */
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

		@GetMapping("/api/unexpectedWithoutMessage")
		public String unexpectedWithoutMessage() {
			throw new IllegalStateException();
		}

		@PostMapping("/api/echo")
		public Map<String, String> echo(@RequestBody Map<String, String> body) {
			return body;
		}

		@GetMapping("/api/number")
		public int number(@RequestParam int value) {
			return value;
		}

		@GetMapping("/api/missing")
		public String missing() {
			throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such plot");
		}

		@GetMapping("/api/unknownStatus")
		public String unknownStatus() {
			throw new ResponseStatusException(499, "Odd", null);
		}
	}

	private final MockMvc mvc = TemplateWiring.mockMvc(new Failing(), new ApiExceptionHandler());

	public ApiExceptionHandlerTest() throws Exception {
	}

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

	@Test
	public void anUnexpectedOneWithoutMessageStillSaysWhatItIs() throws Exception {
		mvc.perform(get("/api/unexpectedWithoutMessage")).andExpect(status().isInternalServerError())
				.andExpect(jsonPath("$.details").value("java.lang.IllegalStateException"));
	}

	@Test
	public void jsonIsReadAndWritten() throws Exception {
		mvc.perform(post("/api/echo").contentType(MediaType.APPLICATION_JSON).content("{\"plot\":\"1\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.plot").value("1"));
	}

	@Test
	public void malformedJsonIsABadRequest() throws Exception {
		mvc.perform(post("/api/echo").contentType(MediaType.APPLICATION_JSON).content("{not json"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("bad-request"));
	}

	@Test
	public void aWrongOrMissingParameterIsABadRequest() throws Exception {
		mvc.perform(get("/api/number").param("value", "many")).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("bad-request"));
		mvc.perform(get("/api/number")).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("bad-request"));
	}

	@Test
	public void aResponseStatusExceptionAnswersItsStatus() throws Exception {
		mvc.perform(get("/api/missing")).andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error").value("not-found"))
				.andExpect(jsonPath("$.message").value("No such plot"));
	}

	@Test
	public void aStatusSpringDoesNotKnowIsStillAnswered() throws Exception {
		mvc.perform(get("/api/unknownStatus")).andExpect(status().is(499))
				.andExpect(jsonPath("$.error").value("status-499"))
				.andExpect(jsonPath("$.message").value("Odd"));
	}

	@Test
	public void anUnmappedAddressIsStillNotFound() throws Exception {
		mvc.perform(get("/api/nothingHere")).andExpect(status().isNotFound());
		mvc.perform(post("/api/expected")).andExpect(status().isMethodNotAllowed());
	}
}

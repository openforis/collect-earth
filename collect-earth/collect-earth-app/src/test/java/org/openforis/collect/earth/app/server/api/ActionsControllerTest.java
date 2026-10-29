package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

/** The quick actions of the menus, answered as the server's own wiring does (see TemplateWiring). */
public class ActionsControllerTest {

	private final AtomicBoolean quit = new AtomicBoolean();
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(new ActionsController(() -> quit.set(true)), new ApiExceptionHandler());
	}

	@Test
	public void quitQuits() throws Exception {
		mvc.perform(post("/api/actions/quit")).andExpect(status().isOk());
		assertTrue(quit.get());
	}

	@Test
	public void anUnknownActionIsNotFound() throws Exception {
		mvc.perform(post("/api/actions/fly")).andExpect(status().isNotFound());
		assertFalse(quit.get());
	}
}

package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.server.api.TemplateWiring;
import org.springframework.test.web.servlet.MockMvc;

/** A second start of Collect Earth asks the running one to open its window; nobody else may. */
public class OpenWindowServletTest {

	private final AtomicInteger opened = new AtomicInteger();
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(new OpenWindowServlet(opened::incrementAndGet));
	}

	@Test
	public void anotherCollectEarthOnThisComputerOpensTheWindow() throws Exception {
		mvc.perform(get("/openWindow")).andExpect(status().isAccepted());
		assertEquals(1, opened.get());
	}

	@Test
	public void aBrowserOrAnotherComputerCannot() throws Exception {
		mvc.perform(get("/openWindow").header("Origin", "https://evil.example.org")).andExpect(status().isForbidden());
		mvc.perform(get("/openWindow").header("Sec-Fetch-Site", "cross-site")).andExpect(status().isForbidden());
		mvc.perform(get("/openWindow").with(request -> {
			request.setRemoteAddr("192.168.1.20");
			return request;
		})).andExpect(status().isForbidden());
		assertEquals(0, opened.get());
	}
}

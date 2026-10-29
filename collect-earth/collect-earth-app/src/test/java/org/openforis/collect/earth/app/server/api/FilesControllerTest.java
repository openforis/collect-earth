package org.openforis.collect.earth.app.server.api;

import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.NativeFileChooser;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** The file dialog the pages ask for, answered as the server's own wiring does (see TemplateWiring). */
public class FilesControllerTest {

	private String askedMode;
	private List<String> askedExtensions;
	private String askedSuggested;

	private final NativeFileChooser chooser = (mode, extensions, suggested) -> {
		askedMode = mode.name();
		askedExtensions = extensions;
		askedSuggested = suggested;
		if ("cancel".equals(suggested)) {
			return null;
		} else if ("headless".equals(suggested)) {
			throw new NativeFileChooser.NoDisplayException();
		} else if ("busy".equals(suggested)) {
			throw new NativeFileChooser.BusyException();
		}
		return "C:/data/plots.csv";
	};
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(new FilesController(chooser), new ApiExceptionHandler());
	}

	@Test
	public void aChosenFileIsAnswered() throws Exception {
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON)
				.content("{\"mode\":\"OPEN\",\"extensions\":[\"csv\",\"ced\"],\"suggested\":\"C:/data\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.path").value("C:/data/plots.csv"))
				.andExpect(jsonPath("$.cancelled").doesNotExist());
		assertEquals("OPEN", askedMode);
		assertEquals(List.of("csv", "ced"), askedExtensions);
		assertEquals("C:/data", askedSuggested);
	}

	@Test
	public void aCancelledDialogSaysSo() throws Exception {
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON)
				.content("{\"mode\":\"SAVE\",\"suggested\":\"cancel\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.cancelled").value(true))
				.andExpect(jsonPath("$.path").doesNotExist());
		assertEquals("SAVE", askedMode);
	}

	@Test
	public void anEmptyRequestOpensAFileOfAnyKind() throws Exception {
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON).content("{}"))
				.andExpect(status().isOk());
		assertEquals("OPEN", askedMode);
		assertEquals(Collections.emptyList(), askedExtensions);
	}

	@Test
	public void extensionsGivenAsNullAreNone() throws Exception {
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON)
				.content("{\"mode\":\"FOLDER\",\"extensions\":null}")).andExpect(status().isOk());
		assertEquals("FOLDER", askedMode);
		assertEquals(Collections.emptyList(), askedExtensions);
	}

	@Test
	public void anUnknownModeIsABadRequest() throws Exception {
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON).content("{\"mode\":\"DELETE\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("bad-request"));
	}

	@Test
	public void withoutADisplayTheServerSaysSo() throws Exception {
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON)
				.content("{\"suggested\":\"headless\"}"))
				.andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.error").value("files.noDisplay"))
				// Messages answers !key! for a key no bundle has
				.andExpect(jsonPath("$.message").value(not(startsWith("!"))));
	}

	@Test
	public void aSecondDialogIsRefusedWhileOneIsOpen() throws Exception {
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON)
				.content("{\"suggested\":\"busy\"}"))
				.andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("files.busy"))
				.andExpect(jsonPath("$.message").value(not(startsWith("!"))));
	}
}

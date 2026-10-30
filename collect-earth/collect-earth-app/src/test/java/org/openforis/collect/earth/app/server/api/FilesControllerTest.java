package org.openforis.collect.earth.app.server.api;

import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
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
	private final List<String> opened = new ArrayList<>();
	private final List<String> revealed = new ArrayList<>();
	private MockMvc mvc;

	@TempDir
	File folder;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(new FilesController(chooser, f -> opened.add(f.getName()), f -> revealed.add(f.getName())), new ApiExceptionHandler());
	}

	private static String json(String path) {
		return "{\"path\":\"" + path.replace("\\", "\\\\") + "\"}";
	}

	@Test
	public void severalFilesAreAnsweredAsPaths() throws Exception {
		// The chooser of these tests offers one file: chooseMany's default answers it as a list
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON)
				.content("{\"mode\":\"OPEN\",\"extensions\":[\"zip\"],\"multiple\":true}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.paths[0]").value("C:/data/plots.csv"))
				.andExpect(jsonPath("$.path").doesNotExist());
		assertEquals("OPEN", askedMode);
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON)
				.content("{\"mode\":\"OPEN\",\"multiple\":true,\"suggested\":\"cancel\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.cancelled").value(true));
		// Several files make no sense for a save or a folder: one as usual
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON).content("{\"mode\":\"SAVE\",\"multiple\":true}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.path").value("C:/data/plots.csv"));
	}

	@Test
	public void aFileIsOpenedAndItsFolderRevealed() throws Exception {
		File file = new File(folder, "export.csv");
		Files.write(file.toPath(), "a,b".getBytes(StandardCharsets.UTF_8));
		mvc.perform(post("/api/files/open").contentType(MediaType.APPLICATION_JSON).content(json(file.getPath())))
				.andExpect(status().isOk()).andExpect(jsonPath("$.path").value(file.getAbsolutePath()));
		assertEquals(List.of("export.csv"), opened);
		mvc.perform(post("/api/files/reveal").contentType(MediaType.APPLICATION_JSON).content(json(file.getPath()))).andExpect(status().isOk());
		mvc.perform(post("/api/files/reveal").contentType(MediaType.APPLICATION_JSON).content(json(folder.getPath()))).andExpect(status().isOk());
		assertEquals(List.of(folder.getName(), folder.getName()), revealed);
	}

	@Test
	public void aFileThatIsNotThereCannotBeOpened() throws Exception {
		mvc.perform(post("/api/files/open").contentType(MediaType.APPLICATION_JSON).content(json(new File(folder, "gone.csv").getPath())))
				.andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("files.missing"));
		mvc.perform(post("/api/files/reveal").contentType(MediaType.APPLICATION_JSON).content("{}"))
				.andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("files.missing"));
		assertTrue(opened.isEmpty());
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

package org.openforis.collect.earth.app.server.api;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** The projects loaded before, and the loading of one, answered as the server's own wiring does (see TemplateWiring). */
public class ProjectsControllerTest {

	@TempDir
	File folder;

	private final EarthProjectsService projects = mock(EarthProjectsService.class);
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final AtomicBoolean restarted = new AtomicBoolean();
	private final Map<String, File> list = new HashMap<>();
	private File sierraLeone;
	private File kenya;
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		sierraLeone = project("sierra_leone");
		kenya = project("kenya");
		list.put("Sierra Leone 2026", sierraLeone);
		list.put("Kenya 2025", kenya);
		when(projects.getProjectList()).thenReturn(list);
		when(properties.getValue(EarthProperty.ACTIVE_PROJECT_DEFINITION)).thenReturn(CollectEarthUtils.getMd5FromFolder(sierraLeone));
		mvc = TemplateWiring.mockMvc(new ProjectsController(projects, properties, () -> restarted.set(true)), new ApiExceptionHandler());
	}

	private File project(String name) throws IOException {
		File project = new File(folder, name);
		assertTrue(project.mkdir());
		Files.write(new File(project, "project_definition.properties").toPath(), ("survey_name=" + name).getBytes(StandardCharsets.UTF_8));
		return project;
	}

	private static String json(String folder) {
		return "{\"folder\":\"" + folder.replace("\\", "\\\\") + "\"}";
	}

	@Test
	public void listsTheProjectsByNameWithTheActiveOneMarked() throws Exception {
		mvc.perform(get("/api/projects")).andExpect(status().isOk())
				.andExpect(jsonPath("$.projects", hasSize(2)))
				.andExpect(jsonPath("$.projects[0].name").value("Kenya 2025"))
				.andExpect(jsonPath("$.projects[0].folder").value(kenya.getAbsolutePath()))
				.andExpect(jsonPath("$.projects[0].active").value(false))
				.andExpect(jsonPath("$.projects[1].name").value("Sierra Leone 2026"))
				.andExpect(jsonPath("$.projects[1].active").value(true));
	}

	@Test
	public void withNoActiveProjectNoneIsMarked() throws Exception {
		when(properties.getValue(EarthProperty.ACTIVE_PROJECT_DEFINITION)).thenReturn("");
		mvc.perform(get("/api/projects")).andExpect(status().isOk())
				.andExpect(jsonPath("$.projects[0].active").value(false)).andExpect(jsonPath("$.projects[1].active").value(false));
	}

	@Test
	public void loadsAProjectAndRestarts() throws Exception {
		when(projects.loadProjectInFolder(kenya)).thenReturn(true);
		mvc.perform(post("/api/projects/load").contentType(MediaType.APPLICATION_JSON).content(json(kenya.getAbsolutePath())))
				.andExpect(status().isOk()).andExpect(jsonPath("$.restart").value(true));
		assertTrue(restarted.get());
	}

	@Test
	public void theProjectLoadedAlreadyDoesNotRestart() throws Exception {
		when(projects.loadProjectInFolder(sierraLeone)).thenReturn(false);
		mvc.perform(post("/api/projects/load").contentType(MediaType.APPLICATION_JSON).content(json(sierraLeone.getAbsolutePath())))
				.andExpect(status().isOk()).andExpect(jsonPath("$.restart").value(false))
				.andExpect(jsonPath("$.message").value(org.openforis.collect.earth.app.view.Messages.getString("SettingsPage.project.alreadyActive")));
		assertFalse(restarted.get());
	}

	@Test
	public void aProjectThatCannotBeLoadedSaysWhy() throws Exception {
		when(projects.loadProjectInFolder(kenya)).thenThrow(new IOException("project_definition.properties is missing"));
		mvc.perform(post("/api/projects/load").contentType(MediaType.APPLICATION_JSON).content(json(kenya.getAbsolutePath())))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("projects.load"))
				.andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.endsWith("project_definition.properties is missing")));
		assertFalse(restarted.get());
	}

	@Test
	public void aFolderThatIsNotOneOfTheProjectsIsRefused() throws Exception {
		mvc.perform(post("/api/projects/load").contentType(MediaType.APPLICATION_JSON).content(json(new File(folder, "elsewhere").getAbsolutePath())))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("projects.unknown"));
		mvc.perform(post("/api/projects/load").contentType(MediaType.APPLICATION_JSON).content("{}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("projects.unknown"));
		verify(projects, never()).loadProjectInFolder(any());
		assertEquals(false, restarted.get());
	}
}

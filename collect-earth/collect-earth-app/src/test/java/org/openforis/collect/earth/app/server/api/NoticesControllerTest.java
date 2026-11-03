package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

public class NoticesControllerTest {

	private final NoticeService notices = new NoticeService();
	private final List<String> answers = new ArrayList<>();
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(new NoticesController(notices), new ApiExceptionHandler());
	}

	@Test
	public void theNoticesAreListedAndAnswered() throws Exception {
		String id = notices.post(new Notice("update", Notice.INFO, "Update", "New version").option("later", "Later"), answers::add);
		mvc.perform(get("/api/notices")).andExpect(status().isOk())
				.andExpect(jsonPath("$.notices[0].id").value(id))
				.andExpect(jsonPath("$.notices[0].title").value("Update"))
				.andExpect(jsonPath("$.notices[0].options[0].id").value("later"));
		mvc.perform(post("/api/notices/" + id + "/answer").contentType(MediaType.APPLICATION_JSON).content("{\"option\":\"later\"}"))
				.andExpect(status().isOk());
		assertEquals(List.of("later"), answers);
		mvc.perform(get("/api/notices")).andExpect(jsonPath("$.notices").isEmpty());
		mvc.perform(post("/api/notices/" + id + "/answer").contentType(MediaType.APPLICATION_JSON).content("{\"option\":\"later\"}"))
				.andExpect(status().isNotFound());
	}
}

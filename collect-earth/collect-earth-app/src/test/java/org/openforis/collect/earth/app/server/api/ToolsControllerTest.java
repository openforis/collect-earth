package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.openforis.collect.earth.app.service.jobs.JobService;
import org.openforis.collect.earth.app.service.tools.AnalysisService;
import org.openforis.collect.earth.app.service.tools.IpccAnswers;
import org.openforis.collect.earth.app.service.tools.ToolsService;
import org.openforis.collect.earth.app.service.tools.ToolsService.DivideCsvRequest;
import org.openforis.collect.earth.app.service.tools.ToolsService.InvalidToolRequestException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** The Tools and Utilities calls, answered as the server's own wiring does (see TemplateWiring), the services stood in for. */
public class ToolsControllerTest {

	private final AnalysisService analysis = mock(AnalysisService.class);
	private final ToolsService tools = mock(ToolsService.class);
	private final JobService jobs = new JobService();
	private final AtomicBoolean restarted = new AtomicBoolean();
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(new ToolsController(analysis, tools, jobs, () -> restarted.set(true)), new ApiExceptionHandler());
	}

	@AfterEach
	public void stop() {
		jobs.shutdown();
	}

	private Map<String, Object> waitUntilOver(String id) throws InterruptedException {
		for (int i = 0; i < 100; i++) {
			Map<String, Object> job = jobs.get(id);
			if (!"RUNNING".equals(job.get("state"))) {
				return job;
			}
			Thread.sleep(50);
		}
		throw new AssertionError("still running");
	}

	private static String idOf(MvcResult result) throws Exception {
		return result.getResponse().getContentAsString().replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
	}

	@Test
	public void saysWhatTheDialogsAskFirst() throws Exception {
		Map<String, Object> flags = new LinkedHashMap<>();
		flags.put("saikuGenerated", true);
		flags.put("saikuToolAvailable", false);
		when(analysis.analysis()).thenReturn(flags);
		mvc.perform(get("/api/tools/analysis")).andExpect(status().isOk())
				.andExpect(jsonPath("$.saikuGenerated").value(true)).andExpect(jsonPath("$.saikuToolAvailable").value(false));
	}

	@Test
	public void theAnalysisJobsStartWithTheirRequests() throws Exception {
		when(analysis.saiku(true)).thenReturn(ctx -> Collections.singletonMap("opened", true));
		String saiku = idOf(mvc.perform(post("/api/jobs/saiku").contentType(MediaType.APPLICATION_JSON).content("{\"refresh\":true}"))
				.andExpect(status().isOk()).andReturn());
		assertEquals("saiku", waitUntilOver(saiku).get("kind"));
		when(analysis.saikuTool(false, "/tmp/SaikuTool.zip")).thenReturn(ctx -> Collections.singletonMap("path", "/tmp/SaikuTool.zip"));
		String tool = idOf(mvc.perform(post("/api/jobs/saikuTool").contentType(MediaType.APPLICATION_JSON).content("{\"refresh\":false,\"path\":\"/tmp/SaikuTool.zip\"}"))
				.andExpect(status().isOk()).andReturn());
		assertEquals(Collections.singletonMap("path", "/tmp/SaikuTool.zip"), waitUntilOver(tool).get("result"));
		when(analysis.ipccPrepare(false)).thenReturn(ctx -> Collections.singletonMap("categories", Collections.emptyList()));
		String prepare = idOf(mvc.perform(post("/api/jobs/ipccPrepare").contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isOk()).andReturn());
		assertEquals("ipcc", waitUntilOver(prepare).get("kind"));
		when(analysis.ipccOutputs(any())).thenReturn(ctx -> Collections.singletonMap("path", "/tmp/ghgi.zip"));
		String outputs = idOf(mvc.perform(post("/api/jobs/ipccOutputs").contentType(MediaType.APPLICATION_JSON)
				.content("{\"country\":\"KE\",\"regionAttribute\":\"province\",\"path\":\"/tmp/ghgi.zip\",\"subdivisions\":[{\"guid\":\"g1\",\"managementType\":\"MANAGED\",\"type\":\"PINUS\"}]}"))
				.andExpect(status().isOk()).andReturn());
		waitUntilOver(outputs);
		ArgumentCaptor<IpccAnswers> answers = ArgumentCaptor.forClass(IpccAnswers.class);
		verify(analysis).ipccOutputs(answers.capture());
		assertEquals("KE", answers.getValue().country);
		assertEquals("g1", answers.getValue().subdivisions.get(0).guid);
		assertEquals("PINUS", answers.getValue().subdivisions.get(0).type);
	}

	@Test
	public void aRequestTheServiceRefusesIsABadRequestWithItsCode() throws Exception {
		when(analysis.saikuTool(anyBoolean(), any())).thenThrow(new InvalidToolRequestException("tools.saikuTool", "Windows only"));
		mvc.perform(post("/api/jobs/saikuTool").contentType(MediaType.APPLICATION_JSON).content("{}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("tools.saikuTool")).andExpect(jsonPath("$.message").value("Windows only"));
		when(tools.deletePlots(anyString())).thenThrow(new InvalidToolRequestException("delete.csv", "wrong header"));
		mvc.perform(post("/api/jobs/deletePlots").contentType(MediaType.APPLICATION_JSON).content("{\"path\":\"/tmp/x.csv\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("delete.csv"));
	}

	@Test
	public void theKmlIsLoadedAndCollectEarthRestarts() throws Exception {
		Map<String, Object> loaded = new LinkedHashMap<>();
		loaded.put("csv", "/tmp/plots.csv");
		loaded.put("plots", 12L);
		when(tools.loadKml("/tmp/points.kml", "/tmp/plots.csv")).thenReturn(loaded);
		mvc.perform(post("/api/tools/loadKml").contentType(MediaType.APPLICATION_JSON).content("{\"kml\":\"/tmp/points.kml\",\"csv\":\"/tmp/plots.csv\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.restart").value(true)).andExpect(jsonPath("$.plots").value(12));
		assertTrue(restarted.get());
		restarted.set(false);
		when(tools.loadKml(eq("/tmp/bad.kml"), anyString())).thenThrow(new InvalidToolRequestException("kml.invalid", "not a kml"));
		mvc.perform(post("/api/tools/loadKml").contentType(MediaType.APPLICATION_JSON).content("{\"kml\":\"/tmp/bad.kml\",\"csv\":\"/tmp/plots.csv\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("kml.invalid"));
		assertFalse(restarted.get());
	}

	@Test
	public void theUtilitiesStartTheirJobs() throws Exception {
		when(tools.missingPlots(Arrays.asList("/tmp/a.csv"))).thenReturn(ctx -> Collections.singletonMap("totalMissing", 2));
		String missing = idOf(mvc.perform(post("/api/jobs/missingPlots").contentType(MediaType.APPLICATION_JSON).content("{\"files\":[\"/tmp/a.csv\"]}"))
				.andExpect(status().isOk()).andReturn());
		assertEquals(Collections.singletonMap("totalMissing", 2), waitUntilOver(missing).get("result"));
		when(tools.divideCsvColumns()).thenReturn(Arrays.asList("id", "region"));
		mvc.perform(get("/api/tools/divideCsv/columns")).andExpect(status().isOk()).andExpect(jsonPath("$.columns[1]").value("region"));
		when(tools.divideCsv(any())).thenReturn(ctx -> Collections.singletonMap("path", "/tmp/out/div_3"));
		String divide = idOf(mvc.perform(post("/api/jobs/divideCsv").contentType(MediaType.APPLICATION_JSON)
				.content("{\"source\":\"/tmp/a.csv\",\"folder\":\"/tmp/out\",\"files\":3,\"randomize\":true,\"column\":1}")).andExpect(status().isOk()).andReturn());
		waitUntilOver(divide);
		ArgumentCaptor<DivideCsvRequest> request = ArgumentCaptor.forClass(DivideCsvRequest.class);
		verify(tools).divideCsv(request.capture());
		assertEquals(3, request.getValue().files);
		assertEquals(1, request.getValue().column);
		assertTrue(request.getValue().randomize);
		Map<String, Object> check = new LinkedHashMap<>();
		check.put("ok", false);
		check.put("message", "wrong header");
		when(tools.deletePlotsCheck("/tmp/d.csv")).thenReturn(check);
		mvc.perform(post("/api/tools/deletePlots/check").contentType(MediaType.APPLICATION_JSON).content("{\"path\":\"/tmp/d.csv\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(false)).andExpect(jsonPath("$.message").value("wrong header"));
		when(tools.deletePlots("/tmp/d.csv")).thenReturn(ctx -> Collections.singletonMap("deleted", 4));
		String delete = idOf(mvc.perform(post("/api/jobs/deletePlots").contentType(MediaType.APPLICATION_JSON).content("{\"path\":\"/tmp/d.csv\"}"))
				.andExpect(status().isOk()).andReturn());
		assertEquals("deletePlots", waitUntilOver(delete).get("kind"));
		verify(analysis, never()).saiku(anyBoolean());
	}
}

package org.openforis.collect.earth.app.server.api;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.openforis.collect.earth.app.service.data.ExportRequest;
import org.openforis.collect.earth.app.service.data.ExportService;
import org.openforis.collect.earth.app.service.data.ExportService.InvalidExportException;
import org.openforis.collect.earth.app.service.data.ImportService;
import org.openforis.collect.earth.app.service.data.ImportService.ExpiredImportException;
import org.openforis.collect.earth.app.service.jobs.JobService;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** The Data menu's calls, answered as the server's own wiring does (see TemplateWiring), with the services stood in for. */
public class DataControllerTest {

	private final ExportService exports = mock(ExportService.class);
	private final ImportService imports = mock(ImportService.class);
	private final JobService jobs = new JobService();
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(new DataController(exports, imports, jobs), new ApiExceptionHandler());
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
		String body = result.getResponse().getContentAsString();
		return body.replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
	}

	@Test
	public void theExportOptionsAreTheServices() throws Exception {
		Map<String, Object> options = new LinkedHashMap<>();
		options.put("formats", Arrays.asList("CSV", "XML", "BACKUP", "KML"));
		options.put("attributes", Collections.emptyList());
		options.put("lastExport", null);
		options.put("survey", "nfi");
		when(exports.options()).thenReturn(options);
		mvc.perform(get("/api/data/export/options")).andExpect(status().isOk())
				.andExpect(jsonPath("$.formats", hasSize(4))).andExpect(jsonPath("$.survey").value("nfi"));
	}

	@Test
	public void theFileNameComesWithTheExtensionOfTheFormat() throws Exception {
		when(exports.fileName(any())).thenReturn("op_collectedData_nfi_on_301026_153000_CSV.csv");
		mvc.perform(post("/api/data/export/fileName").contentType(MediaType.APPLICATION_JSON).content("{\"format\":\"CSV\",\"records\":\"ALL\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.name").value("op_collectedData_nfi_on_301026_153000_CSV.csv"))
				.andExpect(jsonPath("$.extension").value("csv"));
		ArgumentCaptor<ExportRequest> request = ArgumentCaptor.forClass(ExportRequest.class);
		org.mockito.Mockito.verify(exports).fileName(request.capture());
		assertEquals(ExportRequest.Format.CSV, request.getValue().format);
	}

	@Test
	public void anExportStartsAJobWhoseResultIsTheFile() throws Exception {
		when(exports.export(any())).thenReturn(ctx -> Collections.singletonMap("path", "/tmp/x.zip"));
		String id = idOf(mvc.perform(post("/api/jobs/export").contentType(MediaType.APPLICATION_JSON)
				.content("{\"format\":\"XML\",\"records\":\"ALL\",\"path\":\"/tmp/x.zip\"}")).andExpect(status().isOk())
				.andExpect(jsonPath("$.id").exists()).andReturn());
		Map<String, Object> job = waitUntilOver(id);
		assertEquals("DONE", job.get("state"));
		assertEquals("export", job.get("kind"));
		assertEquals(Collections.singletonMap("path", "/tmp/x.zip"), job.get("result"));
	}

	@Test
	public void aRequestTheExportRefusesIsABadRequestWithItsCode() throws Exception {
		when(exports.export(any())).thenThrow(new InvalidExportException("export.path", "Choose where to save the export"));
		mvc.perform(post("/api/jobs/export").contentType(MediaType.APPLICATION_JSON).content("{\"format\":\"XML\",\"records\":\"ALL\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("export.path"))
				.andExpect(jsonPath("$.message").value("Choose where to save the export"));
		when(exports.fileName(any())).thenThrow(new InvalidExportException("export.date", "Choose the date"));
		mvc.perform(post("/api/data/export/fileName").contentType(MediaType.APPLICATION_JSON).content("{\"format\":\"XML\",\"records\":\"FROM_DATE\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("export.date"));
	}

	@Test
	public void aSecondJobOfTheSameKindIsRefusedWhileTheFirstRuns() throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		when(exports.export(any())).thenReturn(ctx -> {
			release.await(5, TimeUnit.SECONDS);
			return null;
		});
		String id = idOf(mvc.perform(post("/api/jobs/export").contentType(MediaType.APPLICATION_JSON).content("{\"format\":\"XML\",\"path\":\"/tmp/x.zip\"}"))
				.andExpect(status().isOk()).andReturn());
		mvc.perform(post("/api/jobs/export").contentType(MediaType.APPLICATION_JSON).content("{\"format\":\"XML\",\"path\":\"/tmp/y.zip\"}"))
				.andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("job.running"))
				.andExpect(jsonPath("$.message").value(Messages.getString("DataPage.job.running")));
		release.countDown();
		waitUntilOver(id);
	}

	@Test
	public void theImportGoesInTwoJobs() throws Exception {
		when(imports.summaries(eq(Arrays.asList("/tmp/a.zip", "/tmp/b.zip")), eq(true))).thenReturn(ctx -> Collections.singletonMap("token", "t1"));
		String summary = idOf(mvc.perform(post("/api/jobs/importSummary").contentType(MediaType.APPLICATION_JSON)
				.content("{\"files\":[\"/tmp/a.zip\",\"/tmp/b.zip\"],\"includeNonFinished\":true}")).andExpect(status().isOk()).andReturn());
		assertEquals("importSummary", waitUntilOver(summary).get("kind"));
		when(imports.importPrepared(eq("t1"), eq(Collections.singletonList("/tmp/a.zip")))).thenReturn(ctx -> Collections.singletonMap("imported", 3));
		String imported = idOf(mvc.perform(post("/api/jobs/import").contentType(MediaType.APPLICATION_JSON)
				.content("{\"token\":\"t1\",\"overwrite\":[\"/tmp/a.zip\"]}")).andExpect(status().isOk()).andReturn());
		assertEquals(Collections.singletonMap("imported", 3), waitUntilOver(imported).get("result"));
		// Without an answer about the conflicts, none is overwritten
		when(imports.importPrepared(eq("t2"), eq(Collections.emptyList()))).thenReturn(ctx -> null);
		assertNotNull(idOf(mvc.perform(post("/api/jobs/import").contentType(MediaType.APPLICATION_JSON).content("{\"token\":\"t2\"}"))
				.andExpect(status().isOk()).andReturn()));
	}

	@Test
	public void anExpiredImportIsAConflictAndNoFilesABadRequest() throws Exception {
		when(imports.importPrepared(anyString(), anyList())).thenThrow(new ExpiredImportException());
		mvc.perform(post("/api/jobs/import").contentType(MediaType.APPLICATION_JSON).content("{\"token\":\"old\"}"))
				.andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("import.expired"))
				.andExpect(jsonPath("$.message").value(Messages.getString("DataPage.import.expired")));
		mvc.perform(post("/api/jobs/importSummary").contentType(MediaType.APPLICATION_JSON).content("{\"files\":[]}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("files.none"));
		mvc.perform(post("/api/jobs/updateCsv").contentType(MediaType.APPLICATION_JSON).content("{}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("files.none"));
		org.mockito.Mockito.verify(imports, org.mockito.Mockito.never()).summaries(anyList(), anyBoolean());
	}

	@Test
	public void theCsvUpdateIsAJobAndItsInfoTheKeyAttributes() throws Exception {
		when(imports.csvInfo()).thenReturn(Collections.singletonMap("keyAttributes", Arrays.asList("id")));
		mvc.perform(get("/api/data/import/csvInfo")).andExpect(status().isOk()).andExpect(jsonPath("$.keyAttributes[0]").value("id"));
		when(imports.updateFromCsv(eq(Collections.singletonList("/tmp/u.csv")))).thenReturn(ctx -> Collections.singletonMap("files", Collections.emptyList()));
		String id = idOf(mvc.perform(post("/api/jobs/updateCsv").contentType(MediaType.APPLICATION_JSON).content("{\"files\":[\"/tmp/u.csv\"]}"))
				.andExpect(status().isOk()).andReturn());
		assertEquals("updateCsv", waitUntilOver(id).get("kind"));
	}
}

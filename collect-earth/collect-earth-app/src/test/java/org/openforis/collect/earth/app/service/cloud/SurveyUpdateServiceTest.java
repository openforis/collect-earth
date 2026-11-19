package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.RestartService;
import org.openforis.collect.earth.app.service.cloud.SurveyUpdateService.Decision;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.springframework.beans.factory.ObjectProvider;

import com.sun.net.httpserver.HttpServer;

/**
 * A cloud project's survey changed in the dashboard's designer (stage 6 of docs/plans/2026-11-18-survey-designer.md):
 * Collect Earth notices it and offers to take it, once; "Update now" opens the project again and restarts.
 */
class SurveyUpdateServiceTest {

	private HttpServer server;
	private final AtomicReference<String> served = new AtomicReference<>("{\"revision\":\"r2\"}");
	private final AtomicInteger status = new AtomicInteger(200);
	private final AtomicReference<String> authorization = new AtomicReference<>();
	private final CloudApiClient api = new CloudApiClient();
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final NoticeService notices = new NoticeService();
	private final CloudService cloud = mock(CloudService.class);
	private final RestartService restart = mock(RestartService.class);
	private final SurveyUpdateService service = new SurveyUpdateService();
	private CloudBinding binding;

	@BeforeEach
	@SuppressWarnings("unchecked")
	void start() throws Exception {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/v1/projects/p1/survey/revision", exchange -> {
			authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
			byte[] body = served.get().getBytes(StandardCharsets.UTF_8);
			exchange.sendResponseHeaders(status.get(), body.length);
			try (OutputStream out = exchange.getResponseBody()) {
				out.write(body);
			}
		});
		server.start();
		String url = "http://127.0.0.1:" + server.getAddress().getPort();
		binding = new CloudBinding("/projects/forest", url, "p1", "Forest", "ana");
		binding.surveyRevision = "r1";
		when(properties.getCloudSyncUrl()).thenReturn(url);
		when(properties.getCloudBinding()).thenAnswer(i -> binding);
		when(properties.getCloudSyncToken()).thenReturn("token-1");
		set(api, "localPropertiesService", properties);
		ObjectProvider<CloudService> provider = mock(ObjectProvider.class);
		when(provider.getObject()).thenReturn(cloud);
		set(service, "properties", properties);
		set(service, "api", api);
		set(service, "notices", notices);
		set(service, "cloud", provider);
		set(service, "restart", restart);
	}

	@AfterEach
	void stop() {
		api.close();
		server.stop(0);
	}

	private static void set(Object target, String name, Object value) throws Exception {
		Field field = target.getClass().getDeclaredField(name);
		field.setAccessible(true);
		field.set(target, value);
	}

	@Test
	void decidesFromTheRevisionKnownAndTheOneServed() {
		assertEquals(Decision.NOTHING, SurveyUpdateService.decide("r1", null, null));
		assertEquals(Decision.REMEMBER, SurveyUpdateService.decide(null, "r1", null));
		assertEquals(Decision.NOTHING, SurveyUpdateService.decide("r1", "r1", null));
		assertEquals(Decision.ASK, SurveyUpdateService.decide("r1", "r2", null));
		assertEquals(Decision.NOTHING, SurveyUpdateService.decide("r1", "r2", "r2"));
		assertEquals(Decision.ASK, SurveyUpdateService.decide("r1", "r3", "r2"));
	}

	@Test
	void asksOnceWhenTheSurveyChangedAndUpdatesOnUpdateNow() throws Exception {
		service.check();
		assertEquals("Bearer token-1", authorization.get());
		List<Map<String, Object>> pending = notices.pending();
		assertEquals(1, pending.size());
		assertEquals(SurveyUpdateService.NOTICE, pending.get(0).get("kind"));
		assertTrue(String.valueOf(pending.get(0).get("message")).contains("Forest"));
		// Asked once for that revision
		service.check();
		assertEquals(1, notices.pending().size());
		notices.answer((String) pending.get(0).get("id"), SurveyUpdateService.UPDATE);
		verify(cloud).open("p1", binding.server);
		verify(restart).run();
	}

	@Test
	void laterChangesNothing() throws Exception {
		service.check();
		notices.answer((String) notices.pending().get(0).get("id"), SurveyUpdateService.LATER);
		verify(cloud, never()).open(any(), any());
		verify(restart, never()).run();
	}

	@Test
	void takesTheFirstRevisionKnownWithoutAsking() {
		binding.surveyRevision = null;
		service.check();
		assertTrue(notices.pending().isEmpty());
		assertEquals("r2", binding.surveyRevision);
		verify(properties).saveCloudBinding(binding);
	}

	@Test
	void aServerWithoutTheDesignerIsNotAsked() {
		status.set(404);
		served.set("{\"error\":\"not_found\"}");
		service.check();
		assertTrue(notices.pending().isEmpty());
		status.set(200);
		served.set("{\"revision\":\"r1\"}");
		service.check();
		assertFalse(notices.hasPending(SurveyUpdateService.NOTICE));
	}

	@Test
	void anUpdateRefusedSaysSoAndDoesNotRestart() throws Exception {
		doThrow(new CloudService.InvalidCloudRequestException("cloud.unsentRecords", "Records of another project are not sent yet.")).when(cloud).open(any(), any());
		service.check();
		notices.answer((String) notices.pending().get(0).get("id"), SurveyUpdateService.UPDATE);
		verify(restart, never()).run();
		assertTrue(String.valueOf(notices.pending().get(0).get("message")).contains("Records of another project are not sent yet."));
	}
}

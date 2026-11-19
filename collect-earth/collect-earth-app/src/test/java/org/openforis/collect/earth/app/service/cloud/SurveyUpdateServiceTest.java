package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InOrder;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.RestartService;
import org.openforis.collect.earth.app.service.cloud.SurveyUpdateService.Decision;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.springframework.beans.factory.ObjectProvider;

import com.sun.net.httpserver.HttpServer;

/**
 * A cloud project's survey changed in the dashboard's designer (stage 6 of docs/plans/2026-11-18-survey-designer.md):
 * Collect Earth notices it and offers to take it, once; "Update now" sends the records not sent yet, opens the project
 * again and restarts.
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
	private final CloudSyncService sync = mock(CloudSyncService.class);
	private final EarthSurveyService surveys = mock(EarthSurveyService.class);
	private final SurveyUpdateService service = new SurveyUpdateService();
	private CloudBinding binding;

	@TempDir
	File folder;

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
		set(service, "sync", sync);
		set(service, "surveys", surveys);
		// The binding as it is stored: changed in place, as LocalPropertiesService does
		when(properties.updateCloudBinding(any(), any())).thenAnswer(i -> {
			i.<Consumer<CloudBinding>> getArgument(1).accept(binding);
			return true;
		});
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
		assertEquals(Decision.NOTHING, SurveyUpdateService.decide("r1", null, null, null));
		assertEquals(Decision.NOTHING, SurveyUpdateService.decide(null, "r1", null, null));
		assertEquals(Decision.NOTHING, SurveyUpdateService.decide("r1", "r1", null, null));
		assertEquals(Decision.ASK, SurveyUpdateService.decide("r1", "r2", null, null));
		assertEquals(Decision.NOTHING, SurveyUpdateService.decide("r1", "r2", "r2", null));
		assertEquals(Decision.ASK, SurveyUpdateService.decide("r1", "r3", "r2", null));
		// One taken that could not be used here: not offered again, but the next one is
		assertEquals(Decision.NOTHING, SurveyUpdateService.decide("r1", "r2", null, "r2"));
		assertEquals(Decision.ASK, SurveyUpdateService.decide("r1", "r3", null, "r2"));
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
		// The form's last changes written and the records sent, before the survey is taken
		InOrder order = inOrder(surveys, sync, cloud, restart);
		order.verify(surveys).flushAll();
		order.verify(sync).sendNow(SurveyUpdateService.SEND_TIMEOUT_MS);
		order.verify(cloud).open("p1", binding.server);
		// The plots saved while it downloaded (the form kept saving) sent too, before the restart
		order.verify(surveys).flushAll();
		order.verify(sync).sendNow(SurveyUpdateService.SEND_TIMEOUT_MS);
		order.verify(restart).run();
		// Restarting: nothing is asked any more
		served.set("{\"revision\":\"r3\"}");
		service.check();
		assertTrue(notices.pending().isEmpty());
	}

	@Test
	void laterChangesNothing() throws Exception {
		service.check();
		notices.answer((String) notices.pending().get(0).get("id"), SurveyUpdateService.LATER);
		verify(cloud, never()).open(any(), any());
		verify(restart, never()).run();
		verify(sync, never()).sendNow(anyLong());
	}

	/**
	 * A project opened by an earlier version, before its survey was changed: the revision it has is its own survey
	 * file's, not the server's, so the change is offered (it used to be taken for the one this computer had).
	 */
	@Test
	void aProjectWithoutARevisionIsComparedByItsOwnSurvey() throws Exception {
		File idm = new File(folder, "placemark.idm.xml");
		Files.write(idm.toPath(), "<survey>before</survey>".getBytes(StandardCharsets.UTF_8));
		binding = new CloudBinding(folder.getPath(), binding.server, "p1", "Forest", "ana");
		when(properties.getImdFile()).thenReturn(idm.getPath());
		service.check();
		assertEquals(SurveyRevision.ofFile(idm), binding.surveyRevision, "kept from then on");
		assertEquals(1, notices.pending().size());
		assertEquals(SurveyUpdateService.NOTICE, notices.pending().get(0).get("kind"));
	}

	@Test
	void aProjectWithoutARevisionWhoseSurveyIsTheServedOneIsNotAsked() throws Exception {
		File idm = new File(folder, "placemark.idm.xml");
		Files.write(idm.toPath(), "<survey>same</survey>".getBytes(StandardCharsets.UTF_8));
		binding = new CloudBinding(folder.getPath(), binding.server, "p1", "Forest", "ana");
		when(properties.getImdFile()).thenReturn(idm.getPath());
		served.set("{\"revision\":\"" + SurveyRevision.ofFile(idm) + "\"}");
		service.check();
		assertTrue(notices.pending().isEmpty());
		assertEquals(SurveyRevision.ofFile(idm), binding.surveyRevision);
	}

	@Test
	void oneOfferAtATime() throws Exception {
		service.check();
		served.set("{\"revision\":\"r3\"}");
		service.check();
		served.set("{\"revision\":\"r4\"}");
		service.check();
		assertEquals(1, notices.pending().size(), "the offer waiting takes the survey served when answered");
		assertTrue(notices.hasPending(SurveyUpdateService.NOTICE));
	}

	@Test
	void aSurveyThatCouldNotBeUsedIsNotOfferedAgain() {
		binding.surveyRevisionRefused = "r2";
		service.check();
		assertTrue(notices.pending().isEmpty());
		served.set("{\"revision\":\"r3\"}");
		service.check();
		assertEquals(1, notices.pending().size());
	}

	/** Records that cannot be sent (offline) are not read with the new survey: nothing is taken, and it is asked later */
	@Test
	void recordsNotSentKeepTheSurveyAndItIsOfferedAgain() throws Exception {
		when(sync.sendNow(anyLong())).thenReturn(new CloudSyncService.Unsent(3, 0));
		service.check();
		notices.answer((String) notices.pending().get(0).get("id"), SurveyUpdateService.UPDATE);
		verify(cloud, never()).open(any(), any());
		verify(restart, never()).run();
		List<Map<String, Object>> pending = notices.pending();
		assertEquals(1, pending.size());
		assertEquals(SurveyUpdateService.RESULT_NOTICE, pending.get(0).get("kind"));
		assertTrue(String.valueOf(pending.get(0).get("message")).contains("3"));
		// The next check offers it again
		service.check();
		assertTrue(notices.hasPending(SurveyUpdateService.NOTICE));
		// Sent now: taken
		when(sync.sendNow(anyLong())).thenReturn(new CloudSyncService.Unsent(0, 0));
		String offer = (String) notices.pending().stream().filter(n -> SurveyUpdateService.NOTICE.equals(n.get("kind"))).findFirst().get().get("id");
		notices.answer(offer, SurveyUpdateService.UPDATE);
		verify(cloud).open("p1", binding.server);
		verify(restart).run();
	}

	/**
	 * Review: records the server refused with an error (or that cannot be prepared) never get sent by trying again: they
	 * do not hold the update back for good, and when others do, the message says how many are which.
	 */
	@Test
	void recordsTheServerRefusedDoNotHoldTheUpdateBack() throws Exception {
		when(sync.sendNow(anyLong())).thenReturn(new CloudSyncService.Unsent(2, 5));
		service.update(binding);
		verify(cloud, never()).open(any(), any());
		String message = String.valueOf(notices.pending().get(0).get("message"));
		assertTrue(message.contains(java.text.MessageFormat.format(org.openforis.collect.earth.app.view.Messages.getString("CloudSurvey.unsent"), 2)), message);
		assertTrue(message.contains(java.text.MessageFormat.format(org.openforis.collect.earth.app.view.Messages.getString("CloudSurvey.refused"), 5)), message);

		when(sync.sendNow(anyLong())).thenReturn(new CloudSyncService.Unsent(0, 5));
		service.update(binding);
		verify(cloud).open("p1", binding.server);
		verify(restart).run();
	}

	/**
	 * Review: the survey this computer has is the one loaded, not the revision the binding kept: a project file opened
	 * into the folder since (older or newer) changes the survey without changing the binding.
	 */
	@Test
	void theSurveyComparedIsTheOneLoaded() throws Exception {
		// An older project file opened since: the served change is offered, though the binding names the served one
		binding.surveyRevision = "r2";
		when(surveys.getLoadedSurveyRevision()).thenReturn("r1");
		service.check();
		assertEquals(1, notices.pending().size());
		assertEquals("r1", binding.surveyRevision, "the binding follows the survey loaded");
		notices.answer((String) notices.pending().get(0).get("id"), SurveyUpdateService.LATER);

		// A newer one (the served survey) opened since: nothing is offered again
		SurveyUpdateService fresh = new SurveyUpdateService();
		for (String name : new String[] { "properties", "api", "notices", "cloud", "restart", "sync", "surveys" }) {
			Field field = SurveyUpdateService.class.getDeclaredField(name);
			field.setAccessible(true);
			field.set(fresh, field.get(service));
		}
		binding.surveyRevision = "r1";
		when(surveys.getLoadedSurveyRevision()).thenReturn("r2");
		fresh.check();
		assertTrue(notices.pending().isEmpty());
		assertEquals("r2", binding.surveyRevision);
	}

	/** Two "Update now" at once: one download and one restart */
	@Test
	void aSecondUpdateWhileOneRunsIsIgnored() throws Exception {
		CountDownLatch opening = new CountDownLatch(1);
		CountDownLatch release = new CountDownLatch(1);
		doAnswer(i -> {
			opening.countDown();
			assertTrue(release.await(10, TimeUnit.SECONDS));
			return null;
		}).when(cloud).open(any(), any());
		Thread first = new Thread(() -> service.update(binding));
		first.start();
		assertTrue(opening.await(10, TimeUnit.SECONDS));
		service.update(binding);
		release.countDown();
		first.join(10_000);
		verify(cloud, times(1)).open(any(), any());
		verify(restart, times(1)).run();
		// Done: asked again, still nothing
		service.update(binding);
		verify(cloud, times(1)).open(any(), any());
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
		Map<String, Object> said = notices.pending().get(0);
		assertEquals(SurveyUpdateService.RESULT_NOTICE, said.get("kind"));
		assertTrue(String.valueOf(said.get("message")).contains("Records of another project are not sent yet."));
		// Not taken: it can be tried again
		doAnswer(i -> null).when(cloud).open(any(), any());
		service.update(binding);
		verify(restart).run();
		assertNull(binding.surveyRevisionRefused);
		verify(cloud, times(2)).open(eq("p1"), any());
	}
}

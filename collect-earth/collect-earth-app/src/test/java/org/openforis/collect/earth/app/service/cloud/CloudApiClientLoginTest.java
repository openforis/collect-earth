package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

/**
 * Signing in to a cloud server (Join cloud project, Log in): the body sent (the second step's code, an invitation) and
 * how its answers are read (a session token; the second step asked for, wrong or unreadable; any other refusal, with
 * the server's error code), against a stand-in of collect-earth-cloud's POST /v1/auth/login.
 */
class CloudApiClientLoginTest {

	private HttpServer server;
	private CloudApiClient client;
	private String baseUrl;
	private final AtomicReference<JsonNode> sent = new AtomicReference<>();
	private final AtomicInteger status = new AtomicInteger(200);
	private final AtomicReference<String> answer = new AtomicReference<>("{\"token\":\"session-1\"}");

	@BeforeEach
	void start() throws IOException {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/v1/auth/login", exchange -> {
			try (InputStream in = exchange.getRequestBody()) {
				sent.set(new ObjectMapper().readTree(in));
			}
			byte[] body = answer.get().getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().set("Content-Type", "application/json");
			exchange.sendResponseHeaders(status.get(), body.length == 0 ? -1 : body.length);
			try (OutputStream out = exchange.getResponseBody()) {
				out.write(body);
			}
		});
		server.start();
		baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/";
		client = new CloudApiClient();
	}

	@AfterEach
	void stop() throws IOException {
		client.close();
		server.stop(0);
	}

	@Test
	void aSignInGivesTheSessionToken() throws IOException {
		assertEquals("session-1", client.login(baseUrl, "maria", "secret-password"));
		assertEquals("maria", sent.get().get("username").asText());
		assertEquals("secret-password", sent.get().get("password").asText());
		// no code and no invitation are sent when there is none
		assertFalse(sent.get().has("code"));
		assertFalse(sent.get().has("inviteToken"));
	}

	@Test
	void theSecondStepsCodeAndTheInvitationAreSentTrimmed() throws IOException {
		assertEquals("session-1", client.login(baseUrl, "maria", "secret-password", " 123456 ", " invite-abc "));
		assertEquals("123456", sent.get().get("code").asText());
		assertEquals("invite-abc", sent.get().get("inviteToken").asText());
		// blank ones are left out
		client.login(baseUrl, "maria", "secret-password", "  ", "");
		assertFalse(sent.get().has("code"));
		assertFalse(sent.get().has("inviteToken"));
	}

	@Test
	void anAnswerWithoutATokenGivesNone() throws IOException {
		answer.set("");
		assertNull(client.login(baseUrl, "maria", "secret-password", "123456"));
	}

	@Test
	void theSecondStepIsAskedForWrongOrUnreadable() {
		status.set(401);
		answer.set("{\"error\":\"second_step_required\"}");
		assertEquals("required", assertThrows(CloudApiClient.SecondStepException.class, () -> client.login(baseUrl, "maria", "pw-12345678")).getKind());
		answer.set("{\"error\":\"invalid_second_step\"}");
		assertEquals("invalid", assertThrows(CloudApiClient.SecondStepException.class, () -> client.login(baseUrl, "maria", "pw-12345678", "000000")).getKind());
		answer.set("{\"error\":\"second_step_unreadable\"}");
		assertEquals("unreadable", assertThrows(CloudApiClient.SecondStepException.class, () -> client.login(baseUrl, "maria", "pw-12345678", "000000")).getKind());
	}

	@Test
	void anyOtherRefusalCarriesTheStatusAndTheServersErrorCode() {
		status.set(401);
		answer.set("{\"error\":\"invalid_credentials\"}");
		CloudApiClient.CloudApiException wrong = assertThrows(CloudApiClient.CloudApiException.class, () -> client.login(baseUrl, "maria", "wrong-password"));
		assertEquals(401, wrong.getStatus());
		assertEquals("invalid_credentials", wrong.getErrorCode());
		assertTrue(wrong.getMessage().startsWith("login failed with HTTP 401"), wrong.getMessage());

		// an answer that is no JSON object, or has no error, has no code
		status.set(502);
		answer.set("<html>Bad gateway</html>");
		assertNull(assertThrows(CloudApiClient.CloudApiException.class, () -> client.login(baseUrl, "maria", "pw-12345678")).getErrorCode());
		answer.set("{\"error\":42}");
		assertNull(assertThrows(CloudApiClient.CloudApiException.class, () -> client.login(baseUrl, "maria", "pw-12345678")).getErrorCode());
		status.set(500);
		answer.set("");
		CloudApiClient.CloudApiException empty = assertThrows(CloudApiClient.CloudApiException.class, () -> client.login(baseUrl, "maria", "pw-12345678"));
		assertEquals(500, empty.getStatus());
		assertNull(empty.getErrorCode());
	}
}

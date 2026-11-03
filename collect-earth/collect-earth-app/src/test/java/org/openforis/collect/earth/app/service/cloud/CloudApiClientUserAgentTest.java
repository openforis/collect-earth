package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.UpdateIniUtils;

import com.sun.net.httpserver.HttpServer;

/**
 * The User-Agent Collect Earth sends to the cloud server, which reads the version from it.
 */
class CloudApiClientUserAgentTest {

	@Test
	void userAgentCarriesTheVersion() {
		assertEquals("CollectEarth/1.24.3 cloud-sync", CloudApiClient.userAgentFor("1.24.3"));
	}

	@Test
	void versionWithoutUpdateIniIsUnknown() {
		assertEquals("CollectEarth/unknown cloud-sync", CloudApiClient.userAgentFor(null));
		assertEquals("CollectEarth/unknown cloud-sync", CloudApiClient.userAgentFor(""));
		assertEquals("CollectEarth/unknown cloud-sync", CloudApiClient.userAgentFor("  \t"));
	}

	@Test
	void versionIsOneToken() {
		assertEquals("CollectEarth/2.0.0-beta cloud-sync", CloudApiClient.userAgentFor(" 2.0.0 -beta\n"));
	}

	@Test
	void requestsSendTheInstalledVersion() throws IOException {
		AtomicReference<String> agent = new AtomicReference<>();
		HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/", exchange -> {
			agent.set(exchange.getRequestHeaders().getFirst("User-Agent"));
			byte[] body = "{\"valid\":false}".getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().set("Content-Type", "application/json");
			exchange.sendResponseHeaders(200, body.length);
			try (OutputStream out = exchange.getResponseBody()) {
				out.write(body);
			}
		});
		server.start();
		CloudApiClient client = new CloudApiClient();
		try {
			client.getJoinPreview("http://127.0.0.1:" + server.getAddress().getPort(), "token");
		} finally {
			client.close();
			server.stop(0);
		}
		assertEquals(CloudApiClient.userAgentFor(UpdateIniUtils.getVersionNameInstalled()), agent.get());
		assertTrue(agent.get().matches("CollectEarth/\\S+ cloud-sync"), agent.get());
	}
}

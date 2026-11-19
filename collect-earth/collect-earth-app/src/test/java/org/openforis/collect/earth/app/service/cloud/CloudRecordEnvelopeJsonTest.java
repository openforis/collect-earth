package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.GZIPInputStream;

import org.apache.commons.io.IOUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

/** The record envelope as it is sent (POST records:batch): the survey's revision only when it is known. */
class CloudRecordEnvelopeJsonTest {

	private HttpServer server;
	private final AtomicReference<String> received = new AtomicReference<>();
	private final CloudApiClient api = new CloudApiClient();

	@BeforeEach
	void start() throws Exception {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/v1/projects/p1/records:batch", exchange -> {
			try (InputStream in = new GZIPInputStream(exchange.getRequestBody())) {
				received.set(IOUtils.toString(in, StandardCharsets.UTF_8));
			}
			byte[] body = "{\"results\":[{\"recordKey\":\"1\",\"status\":\"stored\"},{\"recordKey\":\"2\",\"status\":\"stored\"}]}"
					.getBytes(StandardCharsets.UTF_8);
			exchange.sendResponseHeaders(200, body.length);
			try (OutputStream out = exchange.getResponseBody()) {
				out.write(body);
			}
		});
		server.start();
	}

	@AfterEach
	void stop() {
		api.close();
		server.stop(0);
	}

	@Test
	void theSurveysRevisionIsSentWhenKnown() throws Exception {
		RecordEnvelope known = new RecordEnvelope("1", "uri:forest", "ana", new Date(), true, 1, "<plot/>", Collections.emptyMap(), false, 30,
				"0123456789abcdef01234567");
		RecordEnvelope unknown = new RecordEnvelope("2", "uri:forest", "ana", new Date(), true, 1, "<plot/>", Collections.emptyMap(), false);
		String url = "http://127.0.0.1:" + server.getAddress().getPort();
		assertEquals(2, api.uploadRecordsBatch(new CloudApiClient.Destination(url, "p1", "t"), Arrays.asList(known, unknown)).size());
		JsonNode records = new ObjectMapper().readTree(received.get()).get("records");
		assertEquals("0123456789abcdef01234567", records.get(0).get("surveyRevision").asText());
		assertEquals(30, records.get(0).get("activeSeconds").asInt());
		assertFalse(records.get(1).has("surveyRevision"));
	}
}

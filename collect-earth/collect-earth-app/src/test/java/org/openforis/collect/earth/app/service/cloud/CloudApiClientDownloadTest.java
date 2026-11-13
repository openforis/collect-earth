package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicReference;

import org.apache.commons.codec.digest.DigestUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.AssignmentInfo;

import com.sun.net.httpserver.HttpServer;

/** An assigned plots file that arrives wrong (a bad checksum, a dropped connection) leaves the one in use as it was. */
class CloudApiClientDownloadTest {

	@TempDir
	File folder;

	private HttpServer server;
	private final CloudApiClient client = new CloudApiClient();
	private final AtomicReference<byte[]> csv = new AtomicReference<>("id,x,y\n2,3,4\n".getBytes(StandardCharsets.UTF_8));

	@BeforeEach
	void start() throws Exception {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/csv", exchange -> {
			exchange.sendResponseHeaders(200, csv.get().length);
			try (OutputStream out = exchange.getResponseBody()) {
				out.write(csv.get());
			}
		});
		server.start();
		LocalPropertiesService properties = mock(LocalPropertiesService.class);
		when(properties.getCloudSyncUrl()).thenReturn("http://127.0.0.1:" + server.getAddress().getPort());
		Field field = CloudApiClient.class.getDeclaredField("localPropertiesService");
		field.setAccessible(true);
		field.set(client, properties);
	}

	@AfterEach
	void stop() {
		client.close();
		server.stop(0);
	}

	@Test
	void aWrongFileLeavesTheOneInUseAndAGoodOneReplacesIt() throws IOException {
		File plots = new File(folder, "plots.csv");
		byte[] inUse = "id,x,y\n1,2,3\n".getBytes(StandardCharsets.UTF_8);
		Files.write(plots.toPath(), inUse);

		assertThrows(IOException.class, () -> client.downloadAssignedCsv(new AssignmentInfo("c1", "plots.csv", "bad", "/csv", 1), folder));
		assertArrayEquals(inUse, Files.readAllBytes(plots.toPath()));
		assertEquals(1, folder.list().length, "no partial file is left behind");

		File got = client.downloadAssignedCsv(new AssignmentInfo("c1", "plots.csv", DigestUtils.sha256Hex(csv.get()), "/csv", 1), folder);
		assertEquals(plots.getCanonicalFile(), got);
		assertArrayEquals(csv.get(), Files.readAllBytes(plots.toPath()));
		assertEquals(1, folder.list().length);
	}
}

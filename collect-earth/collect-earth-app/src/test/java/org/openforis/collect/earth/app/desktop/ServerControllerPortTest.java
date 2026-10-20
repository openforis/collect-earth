package org.openforis.collect.earth.app.desktop;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.BindException;

import org.junit.jupiter.api.Test;

class ServerControllerPortTest {

	// What Jetty throws when the port is taken (JAVA-COLLECT-EARTH-557)
	@Test
	void aBindFailureWrappedByJettyIsAPortInUse() {
		IOException jetty = new IOException("Failed to bind to /127.0.0.1:8028", new BindException("Address already in use: bind"));

		assertTrue(ServerController.isPortInUse(jetty));
	}

	@Test
	void otherInputOutputFailuresAreNot() {
		assertFalse(ServerController.isPortInUse(new IOException("The template could not be read")));
	}
}

package org.openforis.collect.earth.app.service.settings;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.view.Messages;

/** The answers of the Test connection buttons, in the UI language. */
public class ConnectionTestTest {

	@AfterEach
	public void english() {
		Messages.setLocale(Locale.ENGLISH);
	}

	@Test
	public void theCloudServersAnswerIsSaidAsTheUserShouldReadIt() {
		assertTrue(ConnectionTest.ofCloudStatus(200).isOk());
		assertEquals("Connection OK!", ConnectionTest.ofCloudStatus(204).getMessage());
		ConnectionTest token = ConnectionTest.ofCloudStatus(401);
		assertFalse(token.isOk());
		assertEquals("The server was reached but the token was rejected (HTTP 401). Please log in again.", token.getMessage());
		assertEquals("The server was reached but the project was not found (HTTP 404). Check the project id.", ConnectionTest.ofCloudStatus(404).getMessage());
		assertEquals("Unexpected response from the cloud server: HTTP 500", ConnectionTest.ofCloudStatus(500).getMessage());
	}

	@Test
	public void aFailureWithoutAMessageIsNamed() {
		assertEquals("Could not connect to the database: java.lang.IllegalStateException",
				ConnectionTest.ofException("SettingsPage.connection.dbFailed", new IllegalStateException()).getMessage());
	}

	@Test
	public void theAnswerIsInTheUiLanguage() {
		Messages.setLocale(new Locale("es", "ES"));
		assertEquals("¡Conexión correcta!", ConnectionTest.ok().getMessage());
		assertEquals("Respuesta inesperada del servidor en la nube: HTTP 502", ConnectionTest.ofCloudStatus(502).getMessage());
	}
}

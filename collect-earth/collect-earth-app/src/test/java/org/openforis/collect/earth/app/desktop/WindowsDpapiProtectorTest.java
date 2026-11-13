package org.openforis.collect.earth.app.desktop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.openforis.collect.earth.app.desktop.WindowsDpapiProtector.Crypt32;
import org.openforis.collect.earth.app.desktop.WindowsDpapiProtector.DataBlob;
import org.openforis.collect.earth.app.service.SecretProtector;

import com.sun.jna.Native;
import com.sun.jna.WString;

/** The cloud token protected with Windows' DPAPI, for real. */
@EnabledOnOs(OS.WINDOWS)
public class WindowsDpapiProtectorTest {

	@Test
	public void theTokenRoundTripsAndOtherBlobsAreNoToken() {
		SecretProtector protector = WindowsDpapiProtector.ifAvailable();
		String stored = protector.protect("Abc-123_xyz");
		assertTrue(stored.startsWith("dpapi:"));
		assertEquals("Abc-123_xyz", protector.reveal(stored));
		assertNull(protector.reveal("dpapi:!!!"));
		// protected by another program of this user, with other entropy: CryptUnprotectData refuses it
		DataBlob out = new DataBlob();
		assertTrue(Native.load("Crypt32", Crypt32.class).CryptProtectData(new DataBlob("Abc-123_xyz".getBytes(StandardCharsets.UTF_8)),
				new WString("other"), new DataBlob("other".getBytes(StandardCharsets.UTF_8)), null, null, 1, out));
		assertNull(protector.reveal("dpapi:" + Base64.getEncoder().encodeToString(out.bytes())));
	}
}

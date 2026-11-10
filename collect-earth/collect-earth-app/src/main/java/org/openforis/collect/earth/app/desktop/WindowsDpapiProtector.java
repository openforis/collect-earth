package org.openforis.collect.earth.app.desktop;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.service.SecretProtector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.sun.jna.Library;
import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.Structure;
import com.sun.jna.WString;

/**
 * The cloud token in earth.properties protected with Windows' Data Protection API (CryptProtectData), for this user on
 * this computer: written as {@code dpapi:} and the result in Base64. Windows keeps the key with the user's account, so
 * a copy of the file taken to another computer, or read by another user, gives no token (recommendation 1 of the data
 * review). No dialog is ever shown (CRYPTPROTECT_UI_FORBIDDEN).
 */
public final class WindowsDpapiProtector implements SecretProtector {

	private static final Logger logger = LoggerFactory.getLogger(WindowsDpapiProtector.class);
	static final String PREFIX = "dpapi:";
	private static final int CRYPTPROTECT_UI_FORBIDDEN = 0x1;
	/** Mixed in, so that the blob is of no use to another program of this user that only calls CryptUnprotectData */
	private static final byte[] ENTROPY = "Collect Earth cloud token".getBytes(StandardCharsets.UTF_8);

	/** DATA_BLOB of wincrypt.h */
	@Structure.FieldOrder({ "cbData", "pbData" })
	public static class DataBlob extends Structure {
		public int cbData;
		public Pointer pbData;

		DataBlob() {
		}

		DataBlob(byte[] data) {
			cbData = data.length;
			pbData = new Memory(Math.max(1, data.length));
			pbData.write(0, data, 0, data.length);
		}

		byte[] bytes() {
			return pbData == null ? new byte[0] : pbData.getByteArray(0, cbData);
		}
	}

	interface Crypt32 extends Library {
		boolean CryptProtectData(DataBlob in, WString description, DataBlob entropy, Pointer reserved, Pointer prompt, int flags,
				DataBlob out);

		boolean CryptUnprotectData(DataBlob in, Pointer description, DataBlob entropy, Pointer reserved, Pointer prompt, int flags,
				DataBlob out);
	}

	interface Kernel32 extends Library {
		Pointer LocalFree(Pointer memory);
	}

	private final Crypt32 crypt32;
	private final Kernel32 kernel32;

	private WindowsDpapiProtector(Crypt32 crypt32, Kernel32 kernel32) {
		this.crypt32 = crypt32;
		this.kernel32 = kernel32;
	}

	/** The protector on Windows, or null elsewhere or when the API cannot be loaded (the token then stays as it is). */
	public static SecretProtector ifAvailable() {
		if (!SystemUtils.IS_OS_WINDOWS) {
			return null;
		}
		try {
			return new WindowsDpapiProtector(Native.load("Crypt32", Crypt32.class), Native.load("Kernel32", Kernel32.class));
		} catch (Throwable e) { // UnsatisfiedLinkError, NoClassDefFoundError: JNA unusable here
			logger.warn("The Windows data protection could not be loaded, the cloud token stays as it is: {}", e.toString());
			return null;
		}
	}

	@Override
	public String prefix() {
		return PREFIX;
	}

	@Override
	public String protect(String plain) {
		DataBlob out = new DataBlob();
		if (!crypt32.CryptProtectData(new DataBlob(plain.getBytes(StandardCharsets.UTF_8)), new WString("Collect Earth"),
				new DataBlob(ENTROPY), null, null, CRYPTPROTECT_UI_FORBIDDEN, out)) {
			throw new IllegalStateException("CryptProtectData failed, error " + Native.getLastError());
		}
		try {
			return PREFIX + Base64.getEncoder().encodeToString(out.bytes());
		} finally {
			kernel32.LocalFree(out.pbData);
		}
	}

	@Override
	public String reveal(String stored) {
		byte[] blob;
		try {
			blob = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
		} catch (IllegalArgumentException e) {
			return null;
		}
		DataBlob out = new DataBlob();
		if (!crypt32.CryptUnprotectData(new DataBlob(blob), null, new DataBlob(ENTROPY), null, null, CRYPTPROTECT_UI_FORBIDDEN, out)) {
			logger.info("The cloud token of earth.properties is not this user's on this computer (error {}): the login is asked for again",
					Native.getLastError());
			return null;
		}
		try {
			return new String(out.bytes(), StandardCharsets.UTF_8);
		} finally {
			kernel32.LocalFree(out.pbData);
		}
	}
}

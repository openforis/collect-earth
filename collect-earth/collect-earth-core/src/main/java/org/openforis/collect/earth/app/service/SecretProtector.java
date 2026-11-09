package org.openforis.collect.earth.app.service;

/**
 * Keeps a secret of earth.properties (the cloud's sign-in token) out of the file in plain text, with the operating
 * system's own protection: on Windows the Data Protection API, which only this user on this computer can undo, so a
 * copy of the file taken elsewhere carries no usable token (recommendation 1 of the data review). Collect Earth's
 * application registers one ({@link LocalPropertiesService#setSecretProtector}); without one, values are kept as they
 * are, as before.
 */
public interface SecretProtector {

	/** The prefix of the values this protector wrote, e.g. {@code dpapi:}: values without it are plain text. */
	String prefix();

	/** The value as written in the file: {@link #prefix()} then what only this user can read back. */
	String protect(String plain);

	/**
	 * The plain value of one written by {@link #protect}, or null when it cannot be read back here: the file was copied
	 * from another computer or user.
	 */
	String reveal(String stored);
}

package org.openforis.collect.earth.app.service.settings;

import java.text.MessageFormat;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.view.Messages;

/**
 * What a Test connection button of the settings page answers: whether the connection works, and why not, in the UI
 * language. The Swing dialogs compared an English text with "Connection OK!" and showed it untranslated.
 */
public final class ConnectionTest {

	private final boolean ok;
	private final String message;

	private ConnectionTest(boolean ok, String message) {
		this.ok = ok;
		this.message = message;
	}

	public static ConnectionTest ok() {
		return new ConnectionTest(true, Messages.getString("SettingsPage.connection.ok"));
	}

	/** @param key a key of Messages, whose {0} is the detail */
	public static ConnectionTest failed(String key, Object detail) {
		return new ConnectionTest(false, MessageFormat.format(Messages.getString(key), detail));
	}

	/** The answer of the cloud server to GET /v1/projects/{id}, as the user should read it */
	public static ConnectionTest ofCloudStatus(int status) {
		if (status >= 200 && status < 300) {
			return ok();
		} else if (status == 401 || status == 403) {
			return failed("SettingsPage.connection.cloudToken", status);
		} else if (status == 404) {
			return failed("SettingsPage.connection.cloudNoProject", status);
		}
		return failed("SettingsPage.connection.cloudUnexpected", status);
	}

	/** A failure that may carry no message (some drivers throw without one): the exception's name then */
	public static ConnectionTest ofException(String key, Exception e) {
		return failed(key, StringUtils.defaultIfBlank(e.getMessage(), e.toString()));
	}

	public boolean isOk() {
		return ok;
	}

	public String getMessage() {
		return message;
	}
}

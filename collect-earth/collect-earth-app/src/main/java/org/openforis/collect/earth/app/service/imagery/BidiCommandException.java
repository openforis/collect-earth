package org.openforis.collect.earth.app.service.imagery;

/**
 * A BiDi command failed for a reason other than a closed tab or browser, or a script that threw in the page: no
 * answer in time, an answer that could not be read, an error of the browser. A fault, reported to Sentry.
 */
public class BidiCommandException extends IllegalStateException {
	private static final long serialVersionUID = 1L;

	public BidiCommandException(String message, Throwable cause) {
		super(message, cause);
	}
}

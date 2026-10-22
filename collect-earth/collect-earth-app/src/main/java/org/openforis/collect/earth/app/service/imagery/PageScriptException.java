package org.openforis.collect.earth.app.service.imagery;

/** A script that Collect Earth runs in a page threw there: a fault of that script (reported to Sentry). */
public class PageScriptException extends RuntimeException {
	private static final long serialVersionUID = 1L;

	public PageScriptException(String message) {
		super(message);
	}
}

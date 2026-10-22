package org.openforis.collect.earth.app.service.imagery;

/**
 * A script that Collect Earth runs in a page threw there: a fault of that script (reported to Sentry). Unless the page
 * was replacing its document meanwhile ({@link #isDocumentReplaced()}): the script had nowhere to run, which happens
 * on every page load and is for the caller to try again, not a fault.
 */
public class PageScriptException extends RuntimeException {
	private static final long serialVersionUID = 1L;

	private final boolean documentReplaced;

	public PageScriptException(String message) {
		this(message, false);
	}

	public PageScriptException(String message, boolean documentReplaced) {
		super(message);
		this.documentReplaced = documentReplaced;
	}

	/** Whether the script failed because the page replaced its document while it ran, rather than throwing. */
	public boolean isDocumentReplaced() {
		return documentReplaced;
	}
}

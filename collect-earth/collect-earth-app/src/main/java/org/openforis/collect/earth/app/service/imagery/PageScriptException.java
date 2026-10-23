package org.openforis.collect.earth.app.service.imagery;

/**
 * A script that Collect Earth runs in a page threw there: a fault of that script (reported to Sentry). Unless the
 * script had nowhere or no time to run, which says nothing about the script and is for the caller to try again, not a
 * fault: the page was replacing its document meanwhile ({@link #isDocumentReplaced()}), which happens on every page
 * load, or was too busy to run it before the answer was due ({@link #isPageBusy()}), as Google Earth Web while it
 * starts.
 */
public class PageScriptException extends RuntimeException {
	private static final long serialVersionUID = 1L;

	private final boolean documentReplaced;
	private final boolean pageBusy;

	public PageScriptException(String message) {
		this(message, false);
	}

	public PageScriptException(String message, boolean documentReplaced) {
		this(message, documentReplaced, false);
	}

	private PageScriptException(String message, boolean documentReplaced, boolean pageBusy) {
		super(message);
		this.documentReplaced = documentReplaced;
		this.pageBusy = pageBusy;
	}

	/** The page did not run the script in time: busy loading, mostly. */
	public static PageScriptException pageBusy(String message) {
		return new PageScriptException(message, false, true);
	}

	/** Whether the script failed because the page replaced its document while it ran, rather than throwing. */
	public boolean isDocumentReplaced() {
		return documentReplaced;
	}

	/** Whether the page did not answer in time, rather than the script throwing. */
	public boolean isPageBusy() {
		return pageBusy;
	}

	/** Whether this is a fault of the script, to report: neither the document replaced nor the page busy. */
	public boolean isFault() {
		return !documentReplaced && !pageBusy;
	}
}

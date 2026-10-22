package org.openforis.collect.earth.app.service.imagery;

/** The tab, or the whole browser, was closed (by the user, mostly): not a fault, the tab is opened again when needed. */
public class TabClosedException extends RuntimeException {
	private static final long serialVersionUID = 1L;

	public TabClosedException(String message, Throwable cause) {
		super(message, cause);
	}
}

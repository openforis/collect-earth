package org.openforis.collect.earth.app.service.imagery;

/** The windows of the imagery browser, see {@link ImageryBrowser#window(ImageryWindow)}. */
public enum ImageryWindow {
	/** The window of Google Earth Web; the only one, with every tab, unless the other sources have a window of their own. */
	MAIN,
	/** The window of the sources other than Google Earth Web, when they are apart from it (on a screen of their own). */
	OTHERS
}

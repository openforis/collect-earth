package org.openforis.collect.earth.app;

import java.text.SimpleDateFormat;

public abstract class EarthConstants {

	public static final SimpleDateFormat DATE_FORMAT_HTTP = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz");

	private EarthConstants() {
		// TODO Auto-generated constructor stub
	}

	public static final String FILLED_IMAGE = "/images/redTransparent.png";

	public static final String NON_FILLED_IMAGE = "/images/transparent.png";

	public static final String LIST_FILLED_IMAGE = "/images/list_filled.png";

	public static final String LIST_NON_FILLED_IMAGE = "/images/list_empty.png";
}

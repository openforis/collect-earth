package org.openforis.collect.earth.app.service.tools;

import java.util.List;

/** What the LULUCF form of the page answers (POST /api/jobs/ipccOutputs): the choices the Swing wizard collected. */
public class IpccAnswers {

	public static class Subdivision {
		public String guid;
		/** The name of the management type chosen (an enum constant of the category) */
		public String managementType;
		/** The forest, perennial crop or vegetation type, for the categories that have one */
		public String type;
	}

	/** The ISO code of the country (CountryUtils) */
	public String country;
	/** The attribute of the survey that holds the region (country, province, district) */
	public String regionAttribute;
	public List<Subdivision> subdivisions;
	/** The ZIP to write */
	public String path;
}

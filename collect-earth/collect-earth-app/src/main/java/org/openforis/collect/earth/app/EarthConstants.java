package org.openforis.collect.earth.app;

import java.util.Locale;

/**
 * Constant container with constants used widely in the application.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class EarthConstants {

	public static final String DATE_FORMAT_HTTP = "EEE, dd MMM yyyy HH:mm:ss zzz";

	public static final String FILLED_IMAGE = "/images/redTransparent.png";

	public static final String NON_FILLED_IMAGE = "/images/transparent.png";

	public static final String LIST_FILLED_IMAGE = "/images/list_filled.png";

	public static final String LIST_NON_FILLED_IMAGE = "/images/list_empty.png";

	public static final String LIST_NOT_FINISHED_IMAGE = "/images/list_not_finished.png";

	public static final String GENERATED_FOLDER = "generated";

	public static final String FOLDER_COPIED_TO_KMZ = "earthFiles";

	public static final String PLACEMARK_FOUND_PARAMETER = "placemark_found";

	public static final String ROOT_ENTITY_NAME = "plot";

	public static final String CHROME_BROWSER = "chrome";

	public static final String FIREFOX_BROWSER = "firefox";

	public static final String EARTH_SURVEY_NAME = "earth";
	
	public enum INSTANCE_TYPE{ SERVER_INSTANCE, CLIENT_INSTANCE};
	
	public enum SAMPLE_SHAPE{ SQUARE_CIRCLE, SQUARE, CIRCLE, OCTAGON};
	
	public enum UI_LANGUAGE{ 
		FR( "Francaise", new Locale("fr", "FR") ) , EN( "English", new Locale("en", "EN") ), ES( "Español", new Locale("es", "ES") );
		
		private Locale locale;
		private String label;
		
		private UI_LANGUAGE(String label, Locale locale){
			this.label = label;
			this.locale = locale;
		}
		
		public Locale getLocale(){
			return locale;
		}
		
		public String getLabel(){
			return label;
		}
	};
	
	public enum DB_DRIVER{ 
		SQLITE("org.sqlite.JDBC", "jdbc:sqlite:collectEarthDatabase.db" ), 
		POSTGRESQL("org.postgresql.Driver", "jdbc:postgresql://hostname:port/dbname");
		
		private String driverClass;
		private String url;

		private DB_DRIVER(String driverClass, String url) {
			this.driverClass = driverClass;
			this.url = url;
		}
		public String getDriverClass() {
			return driverClass;
		}

		public String getUrl() {
			return url;
		}

	};

	private EarthConstants() {
		 throw new AssertionError();
	}
}

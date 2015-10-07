package org.openforis.collect.earth.app;

import java.io.File;
import java.util.Locale;

import org.openforis.collect.earth.app.service.FolderFinder;

/**
 * Constant container with constants used widely in the application.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class EarthConstants {
	
	public static final String COLLECT_EARTH_APPDATA_FOLDER = "CollectEarth"; //$NON-NLS-1$

	public static final String DATE_FORMAT_HTTP = "EEE, dd MMM yyyy HH:mm:ss zzz"; //$NON-NLS-1$
	
	public static final String LIST_FILLED_IMAGE = "images/list_filled.png"; //$NON-NLS-1$

	public static final String LIST_NON_FILLED_IMAGE = "images/list_empty.png"; //$NON-NLS-1$

	public static final String LIST_NOT_FINISHED_IMAGE = "images/list_not_finished.png"; //$NON-NLS-1$
	public static final String GENERATED_FOLDER_SUFFIX =  "generated"; //$NON-NLS-1$
	public static final String GENERATED_FOLDER = FolderFinder.getLocalFolder() + File.separator + GENERATED_FOLDER_SUFFIX;

	public static final String FOLDER_COPIED_TO_KMZ = "earthFiles"; //$NON-NLS-1$

	public static final String PLACEMARK_FOUND_PARAMETER = "placemark_found"; //$NON-NLS-1$

	public static final String ROOT_ENTITY_NAME = "plot"; //$NON-NLS-1$

	public static final String CHROME_BROWSER = "chrome"; //$NON-NLS-1$

	public static final String FIREFOX_BROWSER = "firefox"; //$NON-NLS-1$

	public static final String EARTH_SURVEY_NAME = "earth"; //$NON-NLS-1$
	
	public enum OperationMode{ SERVER_MODE, CLIENT_MODE};
	
	public static final String COLLECT_EARTH_DATABASE_FILE_NAME = "collectEarthDatabase.db";
	
	public static final String COLLECT_EARTH_DATABASE_SQLITE_DB = FolderFinder.getLocalFolder() + File.separator + COLLECT_EARTH_DATABASE_FILE_NAME;

	public static final String COLLECT_REASON_BLANK_NOT_SPECIFIED_MESSAGE = "Reason blank not specified";

	public static final String PLACEMARK_ID_PARAMETER = "collect_text_id";
	public static final String ACTIVELY_SAVED_ATTRIBUTE_NAME = "actively_saved"; //$NON-NLS-1$
	public static final String ACTIVELY_SAVED_ON_ATTRIBUTE_NAME = "actively_saved_on"; //$NON-NLS-1$
	public static final String ACTIVELY_SAVED_PARAMETER = "collect_boolean_" + ACTIVELY_SAVED_ATTRIBUTE_NAME; //$NON-NLS-1$
	public static final String ACTIVELY_SAVED_ON_PARAMETER = "collect_date_" + ACTIVELY_SAVED_ON_ATTRIBUTE_NAME; //$NON-NLS-1$
	public static final String OPERATOR_PARAMETER = "collect_text_operator"; //$NON-NLS-1$
	public static final String SKIP_FILLED_PLOT_PARAMETER = "jump_to_next_plot"; //$NON-NLS-1$
	
	public static final String PLOT_ID = "_plot_id"; //$NON-NLS-1$
	
	public static final String POSTGRES_RDB_SCHEMA = "rdbcollectsaiku"; //$NON-NLS-1$

	
	public enum SAMPLE_SHAPE{ SQUARE_CIRCLE, SQUARE, CIRCLE, OCTAGON};
	
	public enum UI_LANGUAGE{ 
		FR( "Français", new Locale("fr", "FR") ) , EN( "English", new Locale("en", "EN") ), ES( "Español", new Locale("es", "ES")), PT("Português", new Locale("pt","PT") ), VI("tiếng Việt", new Locale("vi","VI") ) , LA("Lao", new Locale("lo","LO") ) ; //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$ //$NON-NLS-6$ //$NON-NLS-7$ //$NON-NLS-8$ //$NON-NLS-9$ //$NON-NLS-10$ //$NON-NLS-11$ //$NON-NLS-12$
		
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
	
	public enum CollectDBDriver{ 
		SQLITE("org.sqlite.JDBC", "jdbc:sqlite:" + COLLECT_EARTH_DATABASE_SQLITE_DB ),  //$NON-NLS-1$ //$NON-NLS-2$
		POSTGRESQL("org.postgresql.Driver", "jdbc:postgresql://REPLACE_HOSTNAME:REPLACE_PORT/REPLACE_DBNAME"); //$NON-NLS-1$ //$NON-NLS-2$
		
		private String driverClass;
		private String url;

		private CollectDBDriver(String driverClass, String url) {
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

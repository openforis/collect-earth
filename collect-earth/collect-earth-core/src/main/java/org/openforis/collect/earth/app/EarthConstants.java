package org.openforis.collect.earth.app;

import java.io.File;
import java.util.Locale;

import org.openforis.collect.earth.app.service.FolderFinder;

/**
 * Constant container with constants used widely in the application.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class EarthConstants {

	public static final String COLLECT_EARTH_APPDATA_FOLDER = "CollectEarth"; //$NON-NLS-1$

	public static final String DATE_FORMAT_HTTP = "EEE, dd MMM yyyy HH:mm:ss zzz"; //$NON-NLS-1$

	public static final String LIST_FILLED_IMAGE = "images/list_filled.png"; //$NON-NLS-1$

	public static final String LIST_NON_FILLED_IMAGE = "images/list_empty.png"; //$NON-NLS-1$

	public static final String LIST_NOT_FINISHED_IMAGE = "images/list_not_finished.png"; //$NON-NLS-1$
	public static final String GENERATED_FOLDER_SUFFIX = "generated"; //$NON-NLS-1$
	public static final String GENERATED_FOLDER = FolderFinder.getCollectEarthDataFolderNoAmpersad() + File.separator
			+ GENERATED_FOLDER_SUFFIX;

	public static final String FOLDER_COPIED_TO_KMZ = "earthFiles"; //$NON-NLS-1$

	public static final String PLACEMARK_FOUND_PARAMETER = "placemark_found"; //$NON-NLS-1$

	public static final String ROOT_ENTITY_NAME = "plot"; //$NON-NLS-1$

	public static final String CHROME_BROWSER = "chrome"; //$NON-NLS-1$

	public static final String FIREFOX_BROWSER = "firefox"; //$NON-NLS-1$

	public static final String EDGE_BROWSER = "edge"; //$NON-NLS-1$

	public static final String SAFARI_BROWSER = "safari"; //$NON-NLS-1$

	public static final String EARTH_SURVEY_NAME = "earth"; //$NON-NLS-1$

	public enum OperationMode {
		SERVER_MODE, CLIENT_MODE
	}

	public static final String COLLECT_EARTH_DATABASE_FILE_NAME = "collectEarthDatabase.db";

	public static final String COLLECT_EARTH_DATABASE_SQLITE_DB = FolderFinder.getCollectEarthDataFolder()
			+ File.separator + COLLECT_EARTH_DATABASE_FILE_NAME;

	public static final String COLLECT_REASON_BLANK_NOT_SPECIFIED_MESSAGE = "Reason blank not specified";

	public static final String PLACEMARK_ID_PARAMETER = "collect_text_id";
	public static final String ACTIVELY_SAVED_ATTRIBUTE_NAME = "actively_saved"; //$NON-NLS-1$
	public static final Integer ACTIVELY_SAVED_BY_USER_VALUE = 1;
	public static final String ACTIVELY_SAVED_ON_ATTRIBUTE_NAME = "actively_saved_on"; //$NON-NLS-1$
	public static final String ACTIVELY_SAVED_PARAMETER = "collect_boolean_" + ACTIVELY_SAVED_ATTRIBUTE_NAME; //$NON-NLS-1$
	public static final String ACTIVELY_SAVED_ON_PARAMETER = "collect_date_" + ACTIVELY_SAVED_ON_ATTRIBUTE_NAME; //$NON-NLS-1$
	public static final String ACTIVELY_SAVED_ON_PARAMETER_OLD = "collect_text_" + ACTIVELY_SAVED_ON_ATTRIBUTE_NAME; //$NON-NLS-1$
	public static final String OPERATOR_ATTRIBUTE_NAME = "operator"; //$NON-NLS-1$
	public static final String OPERATOR_PARAMETER = "collect_text_operator"; //$NON-NLS-1$
	public static final String SKIP_FILLED_PLOT_PARAMETER = "jump_to_next_plot"; //$NON-NLS-1$

	public static final String PLOT_ID = "id"; //$NON-NLS-1$

	public static final String POSTGRES_RDB_SCHEMA_SAIKU = "rdbcollectsaiku"; //$NON-NLS-1$
	public static final String POSTGRES_RDB_SCHEMA_IPCC = "rdbcollectipcc"; //$NON-NLS-1$

	public enum SAMPLE_SHAPE {
		SQUARE("Square (Standard)"), SQUARE_WITH_LARGE_CENTRAL_PLOT("Square (large central point)"), CIRCLE("Circle"),
		KML_POLYGON("Predefined polygon in KML Format within CSV plot file"),
		WKT_POLYGON("Predefined polygon in WKT Format within CSV plot file"),
		GEOJSON_POLYGON("Predefined polygon in GeoJSON Format within CSV plot file"), HEXAGON("Hexagon"),
		NFMA("NFMA plot design (150m length)"), NFMA_250("NFMA plot design (250m length)"),
		SQUARE_CIRCLE("Square with circles (beta)"), NFI_THREE_CIRCLES("NFI cluster with three circular plots"),
		NFI_FOUR_CIRCLES("NFI cluster with four circular plots");

		private String label;

		private SAMPLE_SHAPE(String label) {
			this.label = label;
		}

		@Override
		public String toString() {
			return label;
		}
	}

	public enum UI_LANGUAGE {
		FR("Français", new Locale("fr", "FR")), EN("English", new Locale("en", "EN")), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$ //$NON-NLS-6$
		ES("Español", new Locale("es", "ES")), PT("Português", new Locale("pt", "PT")), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$ //$NON-NLS-6$
		VI("tiếng Việt", new Locale("vi", "VI")), LO("Lao", new Locale("lo", "LO")), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		MN("Монгол", new Locale("mn", "MN")), HI("हिंदी", new Locale("hi", "HI")),
		RU("Pусский", new Locale("ru", "RU")), TR("Türkçe", new Locale("tr", "TR"));

		private Locale locale;
		private String label;

		private UI_LANGUAGE(String label, Locale locale) {
			this.label = label;
			this.locale = locale;
		}

		public Locale getLocale() {
			return locale;
		}

		public String getLabel() {
			return label;
		}
	}

	public enum CollectDBDriver {
		SQLITE("org.sqlite.JDBC", "jdbc:sqlite:" + COLLECT_EARTH_DATABASE_SQLITE_DB), //$NON-NLS-1$ //$NON-NLS-2$
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

	}

	public static final String SAIKU_RDB_SUFFIX = "Saiku"; //$NON-NLS-1$

	public static final String ROUND_ATTRIBUTE_NAME = "round"; //$NON-NLS-1$ // This is the attribute of the survey
																// that stores the round (First assessment, REassssment
																// and so on)

	public static final Object ROUND_FIRST_ASSESSMENT_VALUE = 1; // The assessment round belonging fo the first assessment ( 2 would be for quality control)

	private EarthConstants() {
		throw new AssertionError();
	}
}

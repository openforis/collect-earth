package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Observable;
import java.util.Properties;
import java.util.TreeSet;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.BUFFER_SHAPE;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Class to access Collect Earth configuration. This class is used all over the
 * code in order to fetch the values of the properties that can be configured by
 * the user, by directly editing the earth.properties file or by using the
 * Tools--Properties menu option in the Collect Earth Window.
 *
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class LocalPropertiesService extends Observable {

	/**
	 * Enumeration containing the names of all the possible values that can be
	 * configured in Collect Earth.
	 *
	 * @author Alfonso Sanchez-Paus Diaz
	 *
	 */
	public enum EarthProperty {
		ACTIVE_PROJECT_DEFINITION("active_project_definition"), ALTERNATIVE_BALLOON_FOR_BROWSER(
				"alternative_balloon_for_browser"), AUTOMATIC_BACKUP("automatic_backup"), BALLOON_TEMPLATE_KEY(
				"balloon"), BALLOON_TEMPLATE_KEY_WEB("balloon_web"), BALLOON_TEMPLATE_KEY_CHECKSUM("balloon_checksum"), BROWSER_TO_USE("use_browser"), CHROME_BINARY_PATH(
				"chrome_exe_path"), CRS_KEY("coordinates_reference_system"), CSV_KEY_CHECKSUM(
				"csv_checksum"), DB_DRIVER("db_driver"), DB_HOST(
				"db_host"), DB_NAME("db_name"), DB_PASSWORD(
				"db_password"), DB_PORT("db_port"), DB_USERNAME(
				"db_username"), DISTANCE_BETWEEN_PLOTS(
				"distance_between_plots"), DISTANCE_BETWEEN_SAMPLE_POINTS(
				"distance_between_sample_points"), DISTANCE_TO_PLOT_BOUNDARIES(
				"distance_to_plot_boundaries"), ELEVATION_GEOTIF_DIRECTORY(
				"elevation_geotif_directory"), EXCEPTION_SHOWN(
				"exception_shown"), EXTRA_MAP_URL(
				"extra_map_url"), FIREFOX_BINARY_PATH(
				"firefox_exe_path"), GENERATED_KEY(
				"generated_on"), GOOGLE_MAPS_API_KEY(
				"google_maps_api_key"), SERVER_BIND_ADDRESS(
				"server_bind_address"), HOST_KEY(
				"host"), HOST_PORT_KEY(
				"port"), INNER_SUBPLOT_SIDE(
				"inner_point_side"), JUMP_TO_NEXT(
				"jump_to_next_plot"), KML_TEMPLATE_KEY(
				"template"), KML_TEMPLATE_KEY_CHECKSUM(
				"template_checksum"), LAST_EXPORTED_DATE(
				"last_exported_survey_date"), LAST_IGNORED_UPDATE(
				"last_ignored_update_version"), LAST_USED_FOLDER(
				"last_used_folder"), LOADED_PROJECTS(
				"loaded_projects"), LOCAL_PORT_KEY(
				"local_port"), METADATA_FILE(
				"metadata_file"), MODEL_VERSION_NAME(
				"model_version_name"), NUMBER_OF_SAMPLING_POINTS_IN_PLOT(
				"number_of_sampling_points_in_plot"), OPEN_BALLOON_IN_BROWSER(
				"open_separate_browser_form"), OPEN_STREET_VIEW(
				"open_street_view"), OPERATION_MODE(
				"operation_mode"), OPERATOR_KEY(
				"operator"), SAMPLE_FILE(
				"csv"), SAMPLE_SHAPE(
				"sample_shape"), SAMPLE_POINT_NUMBERS(
				"sample_point_numbers"), SURVEY_NAME(
				"survey_name"), UI_LANGUAGE(
				"ui_language"), LARGE_CENTRAL_PLOT_SIDE(
				"large_central_plot_side"), DISTANCE_TO_BUFFERS(
				"distance_to_buffers"), BUFFER_SHAPE(
				"buffer_shape"), OPEN_PLANET_MAPS(
				"open_planet_maps"), PLANET_MAPS_KEY(
				"planet_maps_key"),  PLANET_MAPS_CE_KEY("planet_maps_ce_key"), GA_API_SECRET("ga_api_secret"),
				PLANET_MAPS_USE_TFO("planet_maps_use_tfo"),
				PLANET_TFO_DATE_FROM("planet_tfo_date_from"),
				PLANET_TFO_DATE_TO("planet_tfo_date_to"),
				OPEN_GEE_APP(
				"open_gee_app"), GEE_MAP_URL(
				"gee_app_url"), OPEN_MAXAR_SECUREWATCH(
				"open_maxar_securewatch"),MAXAR_SECUREWATCH_URL("secure_watch_url"), EARTH_MAP_URL("earth_map_url"),
				OPEN_EARTH_MAP("open_earth_map"),
				EARTH_MAP_LAYERS("earth_map_layers"),
				EARTH_MAP_SCRIPTS("earth_map_scripts"),
				EARTH_MAP_AOI("earth_map_aoi"),
				GEEAPP_FROM_DATE("geeapp_date_from"),
				GEEAPP_TO_DATE("geeapp_date_to"),
				OPEN_ESRI_WAYBACK("open_esri_wayback"),
				/** Share of the height of Google Earth Web's view a plot fills (0.375 when not set), see GoogleEarthWebUrls */
				GEW_PLOT_VIEW_SHARE("gew_plot_view_share"),
				/**
				 * "false" has Collect Earth turn Google Earth Web's fly animation off, so that the camera jumps to each plot
				 * (see javascript_google_earth_web_camera.js); otherwise GEW's own setting is left as it is. Only for
				 * surveys where the ground is known: jumping, GEW never says where the ground is, and a camera aimed at
				 * sea level over higher ground shows nothing
				 */
				GEW_FLY_ANIMATION("gew_fly_animation"),
				WEB_FORM("web_form"),
				DEFERRED_SAVE_DISABLED("deferred_save_disabled"),
				CLOUD_SYNC_ENABLED("cloud_sync_enabled"),
				CLOUD_SYNC_URL("cloud_sync_url"),
				CLOUD_PROJECT_ID("cloud_project_id"),
				// The folder of the project joined: the cloud mode is that project's, not of any other opened after it
				CLOUD_PROJECT_FOLDER("cloud_project_folder"),
				CLOUD_SYNC_TOKEN("cloud_sync_token"),
				/** "true" from joining a cloud project to the next start, which offers to send this computer's records there */
				CLOUD_OFFER_LOCAL_RECORDS("cloud_offer_local_records"),;

		private String name;

		private EarthProperty(String name) {
			this.name = name;
		}

		@Override
		public String toString() {
			return name;
		}

	}

	public static final String DEFAULT_LOCAL_PORT = "8028";

	public static final String LOCAL_HOST = "127.0.0.1";

	private static final String PROPERTIES_FILE_PATH = FolderFinder.getCollectEarthDataFolder() + File.separator
			+ "earth.properties";
	private static final String PROPERTIES_FILE_PATH_FORCED_UPDATE = "earth.properties_forced_update";
	private static final String PROPERTIES_FILE_PATH_INITIAL = "earth.properties_initial";
	private Logger logger = LoggerFactory.getLogger(LocalPropertiesService.class);;
	private Properties properties;
	/** False for a service made for the tests : the user's earth.properties is never written */
	private final boolean persisted;

	public LocalPropertiesService() {
		persisted = true;
		try {
			init();
		} catch (IOException e) {
			logger.error("Error initilizeng Local Properties", e);
		}
	}

	/**
	 * With the properties given, for the tests : earth.properties of the user is neither read nor written
	 */
	public LocalPropertiesService(Properties properties) {
		this.properties = properties;
		persisted = false;
	}

	boolean isPersisted() {
		return persisted;
	}

	public String convertToOSPath(String path) {
		String pathSeparator = File.separator;
		path = path.replace("/", pathSeparator);
		path = path.replace("\\", pathSeparator);
		return path;
	}

	public String getBalloonFile() {
		return convertToOSPath(getValue(EarthProperty.BALLOON_TEMPLATE_KEY));
	}

	public String getBalloonFileWeb() {
		return convertToOSPath(getValue(EarthProperty.BALLOON_TEMPLATE_KEY_WEB));
	}

	public String getBalloonFileChecksum() {
		return getValue(EarthProperty.BALLOON_TEMPLATE_KEY_CHECKSUM);
	}

	public CollectDBDriver getCollectDBDriver() {

		final String collectDbDriver = getValue(EarthProperty.DB_DRIVER);
		if (StringUtils.isBlank(collectDbDriver)) {
			return CollectDBDriver.SQLITE;
		}
		try {
			return CollectDBDriver.valueOf(collectDbDriver.trim().toUpperCase());
		} catch (IllegalArgumentException e) {
			// A typo in earth.properties used to end the start of the application, wherever the driver was first needed
			logger.warn("Unknown " + EarthProperty.DB_DRIVER + " '{}' in the properties, using {}", collectDbDriver, CollectDBDriver.SQLITE.name());
			return CollectDBDriver.SQLITE;
		}

	}

	public String getCrs() {
		return getValue(EarthProperty.CRS_KEY);
	}

	public String getCsvFile() {
		return convertToOSPath(getValue(EarthProperty.SAMPLE_FILE));
	}

	public String getCsvFileChecksum() {
		return getValue(EarthProperty.CSV_KEY_CHECKSUM);
	}

	private String getExportedSurveyName(String surveyName) {
		return EarthProperty.LAST_EXPORTED_DATE + "_" + surveyName;
	}

	public String getEarthMapAOI() {
		return getValue(EarthProperty.EARTH_MAP_AOI);
	}

	public String getEarthMapLayers() {
		return getValue(EarthProperty.EARTH_MAP_LAYERS);
	}

	public String getEarthMapScripts() {
		return getValue(EarthProperty.EARTH_MAP_SCRIPTS);
	}

	public String getEarthMapURL() {
		return getValue(EarthProperty.EARTH_MAP_URL);
	}

	public String getExtraMap() {
		return getValue(EarthProperty.EXTRA_MAP_URL);
	}

	public String getGEEAppURL() {
		return getValue(EarthProperty.GEE_MAP_URL);
	}

	public String getPlanetMapsKey() {
		return getValue(EarthProperty.PLANET_MAPS_KEY);
	}

	public String getPlanetMapsCeKey() {
		return getValue(EarthProperty.PLANET_MAPS_CE_KEY);
	}

	/**
	 * The Google Analytics Measurement Protocol secret. It is written into earth.properties when the installer is built
	 * ( from the ga_api_secret property of the Maven settings ) so that it never has to be stored in the source code.
	 */
	public String getGaApiSecret() {
		return getValue(EarthProperty.GA_API_SECRET);
	}

	public boolean isPlanetMapsUseTfo() {
		return isPropertyActivated(EarthProperty.PLANET_MAPS_USE_TFO);
	}

	/**
	 * Whether balloon field changes are persisted to the database in a deferred
	 * (write-behind) manner instead of on every single change. Enabled by default;
	 * set {@code deferred_save_disabled=true} in earth.properties to force the
	 * previous synchronous-save-on-every-change behaviour.
	 */
	public boolean isDeferredSaveEnabled() {
		return !Boolean.parseBoolean(getValue(EarthProperty.DEFERRED_SAVE_DISABLED));
	}

	public String getPlanetTfoDateFrom() {
		return getValue(EarthProperty.PLANET_TFO_DATE_FROM);
	}

	public String getPlanetTfoDateTo() {
		return getValue(EarthProperty.PLANET_TFO_DATE_TO);
	}

	public String getGeneratedOn() {
		return getValue(EarthProperty.GENERATED_KEY);
	}

	/**
	 * The network interface that the embedded server listens on. The endpoints it publishes are not authenticated : they save records,
	 * load project files and restart the application, so it only listens to this computer unless the server_bind_address property
	 * says otherwise. Set it to 0.0.0.0 to accept the connections of the Collect Earth instances that run in CLIENT_MODE.
	 */
	public String getServerBindAddress() {
		final String bindAddress = getValue(EarthProperty.SERVER_BIND_ADDRESS);
		return StringUtils.isBlank(bindAddress) ? LOCAL_HOST : bindAddress.trim();
	}

	public String getHost() {
		if (getOperationMode().equals(OperationMode.CLIENT_MODE)) {
			return getValue(EarthProperty.HOST_KEY);
		} else {
			return LOCAL_HOST;
		}
	}

	public String getImdFile() {
		return convertToOSPath(getValue(EarthProperty.METADATA_FILE));
	}

	public Date getLastExportedDate(String surveyName) {
		final String value = (String) properties.get(getExportedSurveyName(surveyName));
		Date lastExported = null;
		try {
			if (!StringUtils.isBlank(value)) {
				lastExported = new Date(Long.parseLong(value));
			}
		} catch (final NumberFormatException e) {
			logger.error("Error parsing date", e);
		}

		return lastExported;
	}

	public String getLocalPort() {
		if (getOperationMode().equals(OperationMode.SERVER_MODE)) {
			return getPort();
		} else {
			return getValue(EarthProperty.LOCAL_PORT_KEY);
		}
	}

	public String getModelVersionName() {
		String modelVersion = (java.lang.String) properties.get(EarthProperty.MODEL_VERSION_NAME.toString());
		if (modelVersion != null && modelVersion.trim().length() == 0) {
			modelVersion = null;
		}
		return modelVersion;
	}

	public OperationMode getOperationMode() {
		final String instanceType = getValue(EarthProperty.OPERATION_MODE);
		if (StringUtils.isBlank(instanceType)) {
			return OperationMode.SERVER_MODE;
		}
		try {
			return OperationMode.valueOf(instanceType.trim().toUpperCase());
		} catch (IllegalArgumentException e) {
			logger.warn("Unknown " + EarthProperty.OPERATION_MODE + " '{}' in the properties, using {}", instanceType, OperationMode.SERVER_MODE.name());
			return OperationMode.SERVER_MODE;
		}
	}

	public String getOperator() {
		return getValue(EarthProperty.OPERATOR_KEY);
	}

	public String getPort() {
		String port = getValue(EarthProperty.HOST_PORT_KEY);
		if (StringUtils.isEmpty(port)) {
			port = DEFAULT_LOCAL_PORT;
		}
		return port;
	}

	public String getProjectFolder() {
		final File metadataFile = new File(getImdFile());
		return metadataFile.getParent();
	}

	public SAMPLE_SHAPE getSampleShape() {
		final String value = getValue(EarthProperty.SAMPLE_SHAPE);
		if (StringUtils.isBlank(value)) {
			return SAMPLE_SHAPE.SQUARE;
		}
		try {
			return SAMPLE_SHAPE.valueOf(value.trim().toUpperCase());
		} catch (IllegalArgumentException e) {
			logger.warn("Unknown " + EarthProperty.SAMPLE_SHAPE + " '{}' in the properties, drawing {} plots instead", value, SAMPLE_SHAPE.SQUARE.name());
			return SAMPLE_SHAPE.SQUARE;
		}
	}

	public BUFFER_SHAPE getBufferShape() {
		final String value = getValue(EarthProperty.BUFFER_SHAPE);
		if (StringUtils.isBlank(value)) {
			// Projects that set distance_to_buffers before the shape became configurable expect square reference areas
			return BUFFER_SHAPE.SQUARE;
		}
		try {
			return BUFFER_SHAPE.valueOf(value.trim().toUpperCase());
		} catch (IllegalArgumentException e) {
			logger.warn("Unknown buffer_shape '{}' in the properties, drawing {} reference areas instead", value, BUFFER_SHAPE.SQUARE.name());
			return BUFFER_SHAPE.SQUARE;
		}
	}

	public String getSecureWatchURL() {
		return getValue(EarthProperty.MAXAR_SECUREWATCH_URL);
	}

	public String getTemplateFile() {
		return convertToOSPath(getValue(EarthProperty.KML_TEMPLATE_KEY));
	}

	public String getTemplateFileChecksum() {
		return getValue(EarthProperty.KML_TEMPLATE_KEY_CHECKSUM);
	}

	public UI_LANGUAGE getUiLanguage() {
		final String value = getValue(EarthProperty.UI_LANGUAGE);
		if (StringUtils.isBlank(value)) {
			return UI_LANGUAGE.EN;
		} else {
			UI_LANGUAGE selected = null;
			try {
				selected = UI_LANGUAGE.valueOf(value.toUpperCase());
			} catch (Exception e) {
				logger.warn("Unknown UI Language " + value);
			}

			if (selected != null) {
				return selected;
			} else {
				return UI_LANGUAGE.EN;
			}
		}
	}

	public String getValue(EarthProperty key) {
		String value = (String) properties.get(key.toString());
		if (value == null) {
			value = "";
		}
		if (isSecret(key.toString())) {
			value = revealed(key.toString(), value);
		}
		return value;
	}

	/**
	 * The properties kept with the operating system's protection when there is one (see SecretProtector): the cloud
	 * token of before (one for all), and one per server ({@code cloud_sync_token <server>}).
	 */
	private static final String CLOUD_TOKEN = "cloud_sync_token";
	private static final java.util.concurrent.atomic.AtomicReference<SecretProtector> SECRET_PROTECTOR = new java.util.concurrent.atomic.AtomicReference<>();

	/**
	 * Registers the operating system's protection of the secrets (the cloud token). The ones already in the file in plain
	 * text are protected once they are written again; {@link #protectSecrets()} does it at once.
	 */
	public static void setSecretProtector(SecretProtector protector) {
		SECRET_PROTECTOR.set(protector);
	}

	static boolean isSecret(String key) {
		return CLOUD_TOKEN.equals(key) || key.startsWith(CLOUD_TOKEN + " ");
	}

	/** The plain value of a secret as stored: protected by this computer, or plain text from before. */
	private static String revealed(String key, String stored) {
		SecretProtector protector = SECRET_PROTECTOR.get();
		if (protector == null || stored.isEmpty() || !stored.startsWith(protector.prefix())) {
			return stored;
		}
		String plain = protector.reveal(key, stored);
		// Copied from another computer or user: no token, so the login is asked for again
		return plain == null ? "" : plain;
	}

	/** A secret as it is written: protected when this computer can, else as it is. */
	private static String stored(String key, String value) {
		SecretProtector protector = SECRET_PROTECTOR.get();
		if (protector != null && (value == null || value.isEmpty()) && isSecret(key)) {
			try {
				protector.forget(key);
			} catch (RuntimeException e) {
				LoggerFactory.getLogger(LocalPropertiesService.class).warn("The token kept by the system could not be removed: {}", e.getMessage());
			}
			return value;
		}
		if (protector == null || value == null || value.isEmpty() || !isSecret(key)) {
			return value;
		}
		try {
			return protector.protect(key, value);
		} catch (RuntimeException e) {
			LoggerFactory.getLogger(LocalPropertiesService.class).warn("The token could not be protected, kept as it is: {}", e.getMessage());
			return value;
		}
	}

	/**
	 * At start: writes the secrets kept in plain text with the protection registered, if any, and makes the file
	 * private to its owner on Linux and macOS.
	 */
	public synchronized void protectSecrets() {
		if (persisted) {
			// A file written before this version, with the permissions the user's other files get
			ownerOnly(new File(PROPERTIES_FILE_PATH).toPath());
		}
		SecretProtector protector = SECRET_PROTECTOR.get();
		if (protector == null) {
			return;
		}
		boolean changed = false;
		for (String key : properties.stringPropertyNames()) {
			if (!isSecret(key)) {
				continue;
			}
			String value = properties.getProperty(key);
			if (value != null && !value.isEmpty() && !value.startsWith(protector.prefix())) {
				String protectedValue = stored(key, value);
				if (!protectedValue.equals(value)) {
					properties.setProperty(key, protectedValue);
					changed = true;
				}
			}
		}
		if (changed) {
			storeProperties();
		}
	}

	private void init() throws IOException {
		properties = new Properties() {
			private static final long serialVersionUID = 4358906731731542445L;

			@Override
			public synchronized Enumeration<Object> keys() {
				return Collections.enumeration(new TreeSet<Object>(super.keySet()));
			}
		};

		boolean newInstallation = false;

		File propertiesFileInitial = new File(PROPERTIES_FILE_PATH_INITIAL);

		try {

			File propertiesFile = new File(PROPERTIES_FILE_PATH);
			if (!propertiesFile.exists() || propertiesFile.length() < 300) {

				if (!propertiesFile.exists()) {
					final boolean success = propertiesFile.createNewFile();
					if (!success) {
						throw new IOException("Could not create file " + propertiesFile.getAbsolutePath());
					}
				}
				// The earth.properties file does not exists, this mean that the
				// earth_properties.initial file is used, only the first time
				propertiesFile = propertiesFileInitial;
				newInstallation = true;

			}

			try( FileReader fr = new FileReader(propertiesFile); ){
				properties.load(fr);

				if (!newInstallation) {
					// Add properties in initial_properties that are not present in earth.properites
					// so that adding new properties in coming version does not generate issues with
					// older versions
					if (propertiesFileInitial.exists()) {
						Properties initialProperties = new Properties();
						try( FileReader frPropsFileInit = new FileReader(propertiesFileInitial) ){
							initialProperties.load(frPropsFileInit);
							Enumeration<String> initialPropertyNames = (Enumeration<String>) initialProperties.propertyNames();
							while (initialPropertyNames.hasMoreElements()) {
								String nextElement = initialPropertyNames.nextElement();
								if (properties.get(nextElement) == null) {
									properties.put(nextElement, initialProperties.getProperty(nextElement));
								}
							}
						}
					}

					// UPDATERS!
					// Emergency procedure for forcing the change of a value for updaters!
					File propertiesForceChange = new File(PROPERTIES_FILE_PATH_FORCED_UPDATE);
					if (propertiesForceChange.exists()) {
						try( FileReader frProps = new FileReader(propertiesForceChange);){
							properties.load(frProps);
							// This procedure will only happen right after update
							propertiesForceChange.deleteOnExit();
						}
					}

				}
			}
		} catch (final FileNotFoundException e) {
			logger.error("Could not find properties file", e);
		} catch (final IOException e) {
			logger.error("Could not open properties file", e);
		}
	}


	/**
	 * Whether the sample points of a plot are numbered on the plots map and in Google Earth Web: a project that asks its
	 * questions per sample point (a table with a row per point, as the projects imported from Collect Earth Online
	 * that answer per point) numbers them as its rows.
	 */
	public boolean isSamplePointNumbers() {
		return isPropertyActivated(EarthProperty.SAMPLE_POINT_NUMBERS);
	}

	public boolean isGEEAppSupported() {
		return isPropertyActivated(EarthProperty.OPEN_GEE_APP);
	}

	public boolean isEarthMapSupported() {
		return isPropertyActivated(EarthProperty.OPEN_EARTH_MAP);
	}

	public boolean isEsriWaybackSupported() {
		return isPropertyActivated(EarthProperty.OPEN_ESRI_WAYBACK);
	}

	/** The plots map form generated at runtime from the survey (the default). */
	public static final String WEB_FORM_GENERATED = "generated";
	/** The balloon HTML of the CEP (balloon_web when the CEP has one), as in the first plots map versions. */
	public static final String WEB_FORM_BALLOON = "balloon";

	/** Which data entry form the plots map shows next to the map. */
	public String getWebForm() {
		return WEB_FORM_BALLOON.equals(getValue(EarthProperty.WEB_FORM)) ? WEB_FORM_BALLOON : WEB_FORM_GENERATED;
	}

	public Boolean isExceptionShown() {
		return isPropertyActivated(EarthProperty.EXCEPTION_SHOWN);
	}

	/** Planet is offered once its key is set (open_planet_maps is no longer read): without one it shows nothing. */
	public boolean isPlanetMapsSupported() {
		return !getValue(EarthProperty.PLANET_MAPS_KEY).trim().isEmpty();
	}


	private boolean isPropertyActivated(EarthProperty earthProperty) {
		boolean supported = false;
		String value = getValue(earthProperty);
		if (StringUtils.isNotBlank(value)) {
			supported = Boolean.parseBoolean(value);
		}
		return supported;
	}

	/**
	 * Maxar SecureWatch is disabled, whatever open_maxar_securewatch says. Its address, access.maxar.com/myDigitalGlobe, no
	 * longer resolves, so every plot opened with it enabled failed to load a page (JAVA-COLLECT-EARTH-55F). Answering false
	 * here also covers the project files that still carry open_maxar_securewatch=true. The rest of the integration is kept
	 * so that it can be switched back on here once Maxar has an address that works.
	 */
	public boolean isSecureWatchSupported() {
		return false;
	}

	public boolean isStreetViewSupported() {
		return isPropertyActivated(EarthProperty.OPEN_STREET_VIEW);
	}

	public boolean isUsingPostgreSqlDB() {
		return getCollectDBDriver().equals(CollectDBDriver.POSTGRESQL);
	}

	/**
	 * Whether the collected records should be synchronized in the background to a
	 * Collect Earth cloud project (local SQLite remains the working store). Sync is
	 * driven by the {@link CollectDBDriver#CLOUD} database mode; the
	 * {@code cloud_sync_enabled} property acts only as an emergency kill-switch
	 * (sync runs unless it is explicitly set to {@code false}).
	 */
	public boolean isCloudSyncEnabled() {
		if (!getCollectDBDriver().equals(CollectDBDriver.CLOUD)) {
			return false;
		}
		String killSwitch = getValue(EarthProperty.CLOUD_SYNC_ENABLED);
		return StringUtils.isBlank(killSwitch) || Boolean.parseBoolean(killSwitch);
	}

	public boolean isUsingCloudDB() {
		return getCollectDBDriver().equals(CollectDBDriver.CLOUD);
	}

	/**
	 * A project folder bound to a cloud project: the server, the project there, its name, and the account it was joined
	 * with. Kept in earth.properties ({@link #CLOUD_PROJECTS}), not in the folder: joining unzips the project over its
	 * folder, and a folder copied to another computer is a local project there.
	 */
	public static class CloudBinding {
		public String folder;
		public String server;
		public String projectId;
		public String projectName;
		public String username;
		/** The account's role in the cloud project (admin, reviewer, operator), null when not known */
		public String role;
		/** Whether the account is the server's administrator, null when the server did not say */
		public Boolean serverAdmin;

		public CloudBinding() {
		}

		public CloudBinding(String folder, String server, String projectId, String projectName, String username) {
			this.folder = folder;
			this.server = server;
			this.projectId = projectId;
			this.projectName = projectName;
			this.username = username;
		}
	}

	/** What {@link #CLOUD_PROJECTS} holds: the bindings, and the account signed in on each server (server to username). */
	private static class CloudSettings {
		List<CloudBinding> projects = new ArrayList<>();
		Map<String, String> accounts = new LinkedHashMap<>();
	}

	/** The cloud projects and accounts, as JSON; absent until the single cloud project of before was moved there. */
	static final String CLOUD_PROJECTS = "cloud_projects";
	private static final com.google.gson.Gson GSON = new com.google.gson.Gson();

	/** A server's address as it is compared and kept: trimmed, without the slashes at the end. */
	public static String normalizeServer(String url) {
		String trimmed = StringUtils.trimToEmpty(url);
		while (trimmed.endsWith("/")) {
			trimmed = trimmed.substring(0, trimmed.length() - 1);
		}
		return trimmed;
	}

	private static String tokenKey(String server) {
		return CLOUD_TOKEN + " " + normalizeServer(server);
	}

	private synchronized CloudSettings cloudSettings() {
		String json = properties.getProperty(CLOUD_PROJECTS);
		CloudSettings settings = null;
		try {
			settings = StringUtils.isBlank(json) ? null : GSON.fromJson(json, CloudSettings.class);
		} catch (RuntimeException e) {
			logger.error("The cloud projects of earth.properties cannot be read: {}", e.getMessage());
		}
		if (settings == null) {
			settings = new CloudSettings();
		}
		if (settings.projects == null) {
			settings.projects = new ArrayList<>();
		}
		if (settings.accounts == null) {
			settings.accounts = new LinkedHashMap<>();
		}
		return settings;
	}

	private synchronized void saveCloudSettings(CloudSettings settings) {
		properties.setProperty(CLOUD_PROJECTS, GSON.toJson(settings));
		storeProperties();
	}

	/** The cloud projects of this computer, by folder. */
	public List<CloudBinding> getCloudBindings() {
		return cloudSettings().projects;
	}

	/** The cloud project of a project folder, or null for a local project. */
	public CloudBinding getCloudBinding(File folder) {
		if (folder == null) {
			return null;
		}
		for (CloudBinding binding : getCloudBindings()) {
			if (StringUtils.isNotBlank(binding.folder) && new File(binding.folder).getAbsoluteFile().equals(folder.getAbsoluteFile())) {
				return binding;
			}
		}
		return null;
	}

	/** The cloud project of the project open, or null when it is a local one. */
	public CloudBinding getCloudBinding() {
		String folder = StringUtils.isBlank(getValue(EarthProperty.METADATA_FILE)) ? null : getProjectFolder();
		return folder == null ? null : getCloudBinding(new File(folder));
	}

	/**
	 * Binds a folder to a cloud project. It replaces the folder's binding, and the one of the same cloud project (joined
	 * again with a new link); the other projects keep theirs.
	 */
	public synchronized void saveCloudBinding(CloudBinding binding) {
		binding.server = normalizeServer(binding.server);
		CloudSettings settings = cloudSettings();
		File folder = new File(binding.folder).getAbsoluteFile();
		settings.projects.removeIf(other -> (StringUtils.isNotBlank(binding.projectId) && binding.projectId.equals(other.projectId))
				|| (other.folder != null && new File(other.folder).getAbsoluteFile().equals(folder)));
		binding.folder = folder.getPath();
		settings.projects.add(binding);
		saveCloudSettings(settings);
	}

	/** The token of a server's sign-in, or blank when nobody is signed in there; the one token of before as a fallback. */
	public String getCloudToken(String server) {
		String url = normalizeServer(server);
		if (url.isEmpty()) {
			return getValue(EarthProperty.CLOUD_SYNC_TOKEN);
		}
		String key = tokenKey(url);
		String token = revealed(key, properties.getProperty(key, ""));
		if (StringUtils.isBlank(token) && url.equals(normalizeServer(getValue(EarthProperty.CLOUD_SYNC_URL)))) {
			token = getValue(EarthProperty.CLOUD_SYNC_TOKEN);
		}
		return token;
	}

	/**
	 * Signs in to a server ({@code token} given) or out of it (blank): one account per server, used by every project on
	 * it. Signing in as someone names them the account of those projects; {@code username} null keeps the account's.
	 */
	public synchronized void saveCloudToken(String server, String username, String token) {
		String url = normalizeServer(server);
		if (url.isEmpty()) {
			setValue(EarthProperty.CLOUD_SYNC_TOKEN, token);
			return;
		}
		CloudSettings settings = cloudSettings();
		String key = tokenKey(url);
		if (StringUtils.isBlank(token)) {
			settings.accounts.remove(url);
			stored(key, ""); // the system's copy goes (the macOS Keychain, the Linux keyring)
			properties.remove(key);
			if (url.equals(normalizeServer(getValue(EarthProperty.CLOUD_SYNC_URL)))) {
				// The token of before is the fallback of this server: it goes too
				properties.setProperty(CLOUD_TOKEN, stored(CLOUD_TOKEN, ""));
			}
		} else {
			String account = username != null ? username : settings.accounts.getOrDefault(url, getOperator());
			settings.accounts.put(url, account);
			if (username != null) {
				for (CloudBinding binding : settings.projects) {
					if (url.equals(binding.server)) {
						binding.username = username;
					}
				}
			}
			properties.setProperty(key, stored(key, token));
		}
		saveCloudSettings(settings);
	}

	/** The servers signed in to, with the username of each. */
	public Map<String, String> getCloudAccounts() {
		Map<String, String> accounts = new LinkedHashMap<>();
		cloudSettings().accounts.forEach((server, username) -> {
			if (StringUtils.isNotBlank(getCloudToken(server))) {
				accounts.put(server, username);
			}
		});
		return accounts;
	}

	/**
	 * Once, at start: the single cloud project of before (cloud_sync_url, cloud_project_id, cloud_project_folder, or the
	 * project open in cloud mode) becomes the binding of its folder, and its token the token of its server. The old keys
	 * are left as they were: the token stays the fallback of its server ({@link #getCloudToken}).
	 */
	public synchronized void migrateCloudSettings() {
		if (properties.containsKey(CLOUD_PROJECTS)) {
			return;
		}
		CloudSettings settings = new CloudSettings();
		String url = normalizeServer(getValue(EarthProperty.CLOUD_SYNC_URL));
		String projectId = StringUtils.trimToEmpty(getValue(EarthProperty.CLOUD_PROJECT_ID));
		String folder = getValue(EarthProperty.CLOUD_PROJECT_FOLDER);
		if (StringUtils.isBlank(folder) && getCollectDBDriver() == CollectDBDriver.CLOUD && StringUtils.isNotBlank(getValue(EarthProperty.METADATA_FILE))) {
			folder = getProjectFolder();
		}
		String token = getValue(EarthProperty.CLOUD_SYNC_TOKEN);
		if (!url.isEmpty() && !projectId.isEmpty() && StringUtils.isNotBlank(folder)) {
			// The project's name is asked of the server by the sync (CloudSyncService), the survey's shown until then
			settings.projects.add(new CloudBinding(new File(folder).getAbsolutePath(), url, projectId, null, getOperator()));
			if (StringUtils.isNotBlank(token)) {
				settings.accounts.put(url, getOperator());
				properties.setProperty(tokenKey(url), stored(tokenKey(url), token));
			}
		}
		saveCloudSettings(settings);
	}

	/** The server of the project open: its cloud project's, else the setting of before. */
	public String getCloudSyncUrl() {
		CloudBinding binding = getCloudBinding();
		return binding != null ? binding.server : getValue(EarthProperty.CLOUD_SYNC_URL);
	}

	public String getCloudProjectId() {
		CloudBinding binding = getCloudBinding();
		return binding != null ? binding.projectId : getValue(EarthProperty.CLOUD_PROJECT_ID);
	}

	/** The token of the server of the project open. */
	public String getCloudSyncToken() {
		return getCloudToken(getCloudSyncUrl());
	}

	public void setCloudSyncEnabled(boolean enabled) {
		setValue(EarthProperty.CLOUD_SYNC_ENABLED, Boolean.toString(enabled));
	}

	/** The settings page's server: the cloud project's of the project open, else the setting of before. */
	public synchronized void saveCloudSyncUrl(String url) {
		CloudBinding binding = getCloudBinding();
		if (binding == null) {
			setValue(EarthProperty.CLOUD_SYNC_URL, url);
		} else {
			binding.server = url;
			saveCloudBinding(binding);
		}
	}

	public synchronized void saveCloudProjectId(String projectId) {
		CloudBinding binding = getCloudBinding();
		if (binding == null) {
			setValue(EarthProperty.CLOUD_PROJECT_ID, projectId);
		} else {
			binding.projectId = projectId;
			saveCloudBinding(binding);
		}
	}

	/** The token of the server of the project open: blank signs out of it. */
	public void saveCloudSyncToken(String token) {
		saveCloudToken(getCloudSyncUrl(), null, token);
	}

	public void saveCollectDBDriver(CollectDBDriver driver) {
		setValue(EarthProperty.DB_DRIVER, driver.name());
	}

	public boolean isUsingSqliteDB() {
		// CLOUD mode also stores data in the local SQLite database (it only adds
		// background sync), so it shares all SQLite-specific behaviour.
		CollectDBDriver driver = getCollectDBDriver();
		return driver.equals(CollectDBDriver.SQLITE) || driver.equals(CollectDBDriver.CLOUD);
	}


	public void nullifyChecksumValues() {
		saveBalloonFileChecksum("");
		saveCsvFileCehcksum("");
		saveTemplateFileChecksum("");
		storeProperties();
	}

	public void removeModelVersionName() {
		setValue(EarthProperty.MODEL_VERSION_NAME, "");
	}

	public void saveBalloonFileChecksum(String checksum) {
		setValue(EarthProperty.BALLOON_TEMPLATE_KEY_CHECKSUM, checksum);

	}

	public void saveCrs(String crsName) {
		setValue(EarthProperty.CRS_KEY, crsName);

	}

	public void saveCsvFile(String csvFile) {
		setValue(EarthProperty.SAMPLE_FILE, csvFile);

	}

	public void saveCsvFileCehcksum(String checksum) {
		setValue(EarthProperty.CSV_KEY_CHECKSUM, checksum);

	}

	public void saveHost(String hostName) {
		setValue(EarthProperty.HOST_KEY, hostName);

	}

	public void saveOperator(String operatorName) {
		setValue(EarthProperty.OPERATOR_KEY, operatorName);

	}

	public void savePort(String portName) {
		setValue(EarthProperty.HOST_PORT_KEY, portName);

	}

	public void saveTemplateFileChecksum(String checksum) {
		setValue(EarthProperty.KML_TEMPLATE_KEY_CHECKSUM, checksum);

	}

	public void setExceptionShown(Boolean showException) {
		setValue(EarthProperty.EXCEPTION_SHOWN, showException.toString());
	}

	public void setJumpToNextPlot(String shouldSkip) {
		String booleanSkip = "";
		if (shouldSkip != null && shouldSkip.length() > 0) {
			if (shouldSkip.equals("on")) {
				booleanSkip = "true";
			} else if (shouldSkip.equals("off")) {
				booleanSkip = "false";
			}
		} else {
			booleanSkip = "false";
		}
		setValue(EarthProperty.JUMP_TO_NEXT, booleanSkip);

	}

	public void setLastExportedDate(String surveyName) {
		setValue(getExportedSurveyName(surveyName), Long.toString(System.currentTimeMillis()));
	}

	public void setModelVersionName(String modelVersionName) {
		setValue(EarthProperty.MODEL_VERSION_NAME, modelVersionName);
	}

	public void setSampleShape(SAMPLE_SHAPE shape) {
		setValue(EarthProperty.SAMPLE_SHAPE, shape.name());
	}

	public void setBufferShape(BUFFER_SHAPE shape) {
		setValue(EarthProperty.BUFFER_SHAPE, shape.name());
	}

	public void setUiLanguage(UI_LANGUAGE language) {
		setValue(EarthProperty.UI_LANGUAGE, language.name());
	}

	public void setValue(Object key, String value) {
		properties.setProperty(key.toString(), stored(key.toString(), value));
		this.setChanged();
		this.notifyObservers(key);
		storeProperties();
	}

	/**
	 * Several values in one write of earth.properties: the settings page saves its changes together, where the Swing
	 * dialog wrote the file once per property. The observers are told of each key, by its name.
	 */
	public void setValues(Map<String, String> values) {
		for (Map.Entry<String, String> value : values.entrySet()) {
			properties.setProperty(value.getKey(), stored(value.getKey(), value.getValue()));
			this.setChanged();
			this.notifyObservers(value.getKey());
		}
		storeProperties();
	}


	public boolean shouldJumpToNextPlot() {
		boolean jumpToNext = false;
		if (getValue(EarthProperty.JUMP_TO_NEXT) != null && getValue(EarthProperty.JUMP_TO_NEXT).length() > 0) {
			jumpToNext = Boolean.parseBoolean(getValue(EarthProperty.JUMP_TO_NEXT));
		}

		return jumpToNext;
	}

	private synchronized void storeProperties() {
		if (!persisted) {
			return;
		}

		File propertiesFile = new File(PROPERTIES_FILE_PATH);
		try(FileWriter fw = new FileWriter(propertiesFile) ) {
			properties.store(fw, null);
		} catch (final IOException e) {
			logger.error("The properties could not be saved", e);
		}
		ownerOnly(propertiesFile.toPath());
	}

	private static final java.util.Set<java.nio.file.attribute.PosixFilePermission> OWNER_ONLY =
			java.nio.file.attribute.PosixFilePermissions.fromString("rw-------");

	/**
	 * On Linux and macOS, earth.properties readable and writable by its owner only (600): it holds the cloud token
	 * and the database password, and the user's home may be readable by the other accounts of the computer. Windows
	 * keeps a user's profile to them already (and the token is protected there, WindowsDpapiProtector).
	 *
	 * @return whether the permissions are owner-only now (false on a file system without POSIX permissions)
	 */
	static boolean ownerOnly(java.nio.file.Path file) {
		try {
			if (!java.nio.file.Files.exists(file)
					|| !file.getFileSystem().supportedFileAttributeViews().contains("posix")) {
				return false;
			}
			if (!OWNER_ONLY.equals(java.nio.file.Files.getPosixFilePermissions(file))) {
				java.nio.file.Files.setPosixFilePermissions(file, OWNER_ONLY);
			}
			return true;
		} catch (IOException | RuntimeException e) {
			LoggerFactory.getLogger(LocalPropertiesService.class).warn("The settings file could not be made private to its owner: {}", e.getMessage());
			return false;
		}
	}



}

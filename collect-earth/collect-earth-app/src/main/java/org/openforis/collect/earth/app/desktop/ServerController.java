package org.openforis.collect.earth.app.desktop;

import java.io.File;
import java.io.IOException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Map;
import java.util.Observable;
import java.util.Observer;

import javax.servlet.ServletContext;

import org.eclipse.jetty.server.Connector;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;
import org.eclipse.jetty.util.thread.ExecutorThreadPool;
import org.eclipse.jetty.webapp.WebAppContext;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.BrowserService;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.BeanCreationException;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.context.support.WebApplicationContextUtils;

import freemarker.template.TemplateException;

/**
 * Controls the Jetty server, starting and stopping it as well as reporting its staus.
 *
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class ServerController extends Observable {

	private static final String EARTH_SUBDOMAIN = "earth"; //$NON-NLS-1$


	public static final String SAIKU_RDB_SUFFIX = "Saiku"; //$NON-NLS-1$
	public static final String IPCC_RDB_SUFFIX = "Ipcc"; //$NON-NLS-1$
	
	// Make sure that the default ports are the same for Server and Generator
	private static final String DEFAULT_PORT = "80"; //$NON-NLS-1$

	public enum ServerInitializationEvent{
		SERVER_STOPPED_EVENT("The Server has stopped"),
		SERVER_STARTED_EVENT("The server started without problems"),
		SERVER_STARTED_NO_DB_CONNECTION_EVENT("Collect Earth could not start due to a DB connection issue"),
		SERVER_STARTED_WITH_DATABASE_CHANGE_EVENT( "Collect Earth started but the PostgreSQL DB could not be reached (SQLite used instead until problems are fixed)");

		private String message;

		private ServerInitializationEvent(String message) {
			this.message = message;
		}

		@Override
		public String toString() {
			return message;
		}

	}

	private Server server;
	private final Logger logger = LoggerFactory.getLogger(ServerController.class);
	private WebAppContext root;
	static LocalPropertiesService localPropertiesService;

	public WebApplicationContext getContext() {
		WebApplicationContext webApplicationContext = null;
		try {
			webApplicationContext = WebApplicationContextUtils.getRequiredWebApplicationContext((ServletContext) getRoot().getServletContext());
		} catch (Exception e) {
			logger.error("Error getting web application context", e); //$NON-NLS-1$
		}
		return webApplicationContext;
	}

	private static String getDbURL(final CollectDBDriver collectDBDriver) {
		// jdbc:postgresql://hostname:port/dbname

		String url = collectDBDriver.getUrl();
		url = url.replace("REPLACE_HOSTNAME", localPropertiesService.getValue(EarthProperty.DB_HOST)); //$NON-NLS-1$
		url = url.replace("REPLACE_PORT", localPropertiesService.getValue(EarthProperty.DB_PORT)); //$NON-NLS-1$
		url = url.replace("REPLACE_DBNAME", localPropertiesService.getValue(EarthProperty.DB_NAME)); //$NON-NLS-1$
		return url;
	}

	private int getPort() {

		String webPort = localPropertiesService.getLocalPort();
		if (webPort == null || webPort.isEmpty()) {
			webPort = DEFAULT_PORT;
		}
		return Integer.parseInt(webPort);
	}

	private WebAppContext getRoot() {
		return root;
	}

	private void setRoot(WebAppContext root) {
		this.root = root;
	}

	private boolean initilizeDataSources() throws IOException, TemplateException {

		CollectDBDriver collectDBDriver = localPropertiesService.getCollectDBDriver();
		boolean isConnectionTypeSwitched = false;
		if(localPropertiesService.isUsingPostgreSqlDB() && !isPostgreSQLReachable(collectDBDriver) ){

			logger.warn("Impossible to reach the PostgreSQL server at " + getDbURL(CollectDBDriver.POSTGRESQL));
			logger.warn("Using the SQLite version until fixed!");
			logger.error("Impossible to reach the PostgreSQL server at " + getDbURL(CollectDBDriver.POSTGRESQL) + " using SQLite version");
			collectDBDriver = CollectDBDriver.SQLITE;
			isConnectionTypeSwitched = true;
		}

		final File jettyAppCtxTemplateSrc = new File("resources/applicationContext.fmt"); //$NON-NLS-1$
		final File jettyAppCtxDst = new File(EarthConstants.GENERATED_FOLDER + "/applicationContext.xml"); //$NON-NLS-1$

		jettyAppCtxDst.getParentFile().mkdirs();

		final Map<String, String> data = new java.util.HashMap<>();

		data.put("driver", collectDBDriver.getDriverClass()); //$NON-NLS-1$
		data.put("url", getDbURL(collectDBDriver)); //$NON-NLS-1$
		data.put("urlSaiku", getSaikuDbURL(collectDBDriver)); //$NON-NLS-1$
		data.put("urlIpcc", getIpccDbURL(collectDBDriver)); //$NON-NLS-1$
		data.put("username", localPropertiesService.getValue(EarthProperty.DB_USERNAME)); //$NON-NLS-1$
		data.put("password", localPropertiesService.getValue(EarthProperty.DB_PASSWORD)); //$NON-NLS-1$
		data.put("collectEarthExecutionFolder", System.getProperty("user.dir") + File.separator); //$NON-NLS-1$ //$NON-NLS-2$

		FreemarkerTemplateUtils.applyTemplate(jettyAppCtxTemplateSrc, jettyAppCtxDst, data);


		return isConnectionTypeSwitched;

	}

	private boolean isPostgreSQLReachable(CollectDBDriver collectDBDriver) {
		boolean connectionWorked = false;
		try ( Connection connection = DriverManager.getConnection(
				getDbURL(collectDBDriver),
				localPropertiesService.getValue(EarthProperty.DB_USERNAME),
				localPropertiesService.getValue(EarthProperty.DB_PASSWORD)
				) ){
			String query="select version()";
			try( Statement s = connection.createStatement() ){
				try( ResultSet rs=s.executeQuery(query) ){
					while(rs.next())
					{
						logger.debug( "It works, there are " + rs.getString(1) + " rows on the ofc_record table");
					}
					connectionWorked = true;
				}
			}
		}
		catch(Exception e){
			logger.error("Error while testing the connection to the postgresSQL DB", e);
		}

		return connectionWorked;

	}

	public static String getSaikuDbURL(CollectDBDriver collectDBDriver) {
		String urlSaikuDB = getDbURL(collectDBDriver);

		if (localPropertiesService.isUsingSqliteDB()) {
			urlSaikuDB += EarthConstants.SAIKU_RDB_SUFFIX;
		}
		return urlSaikuDB;
	}

	public static String getIpccDbURL(CollectDBDriver collectDBDriver) {
		String urlIpccDB = getDbURL(collectDBDriver);

		if (localPropertiesService.isUsingSqliteDB()) {
			urlIpccDB += IPCC_RDB_SUFFIX;
		}
		return urlIpccDB;
	}
	
	public void startServer(Observer observeInitialization) throws Exception {

		localPropertiesService = new LocalPropertiesService();

		this.addObserver(observeInitialization);

		boolean postgresConnectionSwitchedtoSqlite = initilizeDataSources();
		try {

			final String webappDirLocation = FolderFinder.getCollectEarthDataFolder();

			// The port that we should run on can be set into an environment variable
			// Look for that variable and default to 8080 if it isn't there.

			// For log4j 1.2 --> Moving to Log4J2
			//PropertyConfigurator.configure(this.getClass().getResource("/WEB-INF/conf/log4j.properties"));

			//server = new Server(new ExecutorThreadPool(10, 50, 5, TimeUnit.SECONDS)); // For JEtty 7
			//server = new Server(new ExecutorThreadPool(50, 50, 5, TimeUnit.MILLISECONDS) ); // For JEtty 9, different parameters for the constructor
			server = new Server(new ExecutorThreadPool() ); // For JEtty 9.4, different parameters for the constructor

			// // Use blocking-IO connector to improve throughput
			final ServerConnector connector = new ServerConnector(server);
			connector.setName( LocalPropertiesService.LOCAL_HOST + ":" + getPort()); //$NON-NLS-1$
			connector.setHost("0.0.0.0"); //$NON-NLS-1$
			//connector.setHost( LocalPropertiesService.LOCAL_HOST );

			connector.setPort(getPort());

			//connector.setStopTimeout(1000); Change to setIdleTimeout ??

			server.setConnectors(new Connector[] { connector });

			WebAppContext wweAppContext = new WebAppContext();
			setRoot(wweAppContext);

			getRoot().setContextPath("/" + EARTH_SUBDOMAIN); //$NON-NLS-1$

			getRoot().setDescriptor(this.getClass().getResource("/WEB-INF/web.xml").toURI().toString()); //$NON-NLS-1$

			getRoot().setResourceBase(webappDirLocation);

			// Parent loader priority is a class loader setting that Jetty accepts.
			// By default Jetty will behave like most web containers in that it will
			// allow your application to replace non-server libraries that are part of the container.
			// Setting parent loader priority to true changes this behaviour.
			// Read more here:
			// http://wiki.eclipse.org/Jetty/Reference/Jetty_Classloading
			getRoot().setParentLoaderPriority(true);

			server.setHandler(getRoot());
			server.setStopAtShutdown(true);
			server.start();
			setChanged();

			Object attribute = getRoot().getServletContext().getAttribute(WebApplicationContext.ROOT_WEB_APPLICATION_CONTEXT_ATTRIBUTE);
			if (attribute instanceof BeanCreationException) {
				( (BeanCreationException) attribute).printStackTrace(System.out);
				logger.error("Error creating the database connection", attribute); //$NON-NLS-1$
				notifyObservers(ServerInitializationEvent.SERVER_STARTED_NO_DB_CONNECTION_EVENT);
			} else {
				if (postgresConnectionSwitchedtoSqlite){
					notifyObservers(ServerInitializationEvent.SERVER_STARTED_WITH_DATABASE_CHANGE_EVENT);
				}else{
					notifyObservers(ServerInitializationEvent.SERVER_STARTED_EVENT);
				}
			}

			// Force the local properties to be loaded before the browserservice is instantiated!! DO NOT REMOVE
			//getContext().getBean(LocalPropertiesService.class);
			//this.addObserver(getContext().getBean(BrowserService.class));

		} catch (final IOException e) {
			logger.error("Error initializing local properties", e); //$NON-NLS-1$
			System.exit(1);
		} catch (Exception e) {
			logger.error("Error staring the server", e); //$NON-NLS-1$
			System.exit(1);
			
		}


	}

	public void stopServer() throws Exception {
		if (server != null && server.isRunning()) {
			server.stop();
			setChanged();
			notifyObservers(ServerInitializationEvent.SERVER_STOPPED_EVENT); // TODO remove observers
		}
	}


	public static String getHostAddress(String host, String port) {
		String hostAndPort = ""; //$NON-NLS-1$
		if (host != null && host.length() > 0) {
			hostAndPort = host;
			if (port != null && port.length() > 0) {
				hostAndPort += ":" + port; //$NON-NLS-1$
			}

			hostAndPort = "http://" + hostAndPort + "/" + EARTH_SUBDOMAIN + "/"; //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		}
		return hostAndPort;

	}
}

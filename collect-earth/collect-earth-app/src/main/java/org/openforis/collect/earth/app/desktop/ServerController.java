package org.openforis.collect.earth.app.desktop;

import java.io.File;
import java.io.IOException;
import java.util.Map;
import java.util.Observable;
import java.util.Observer;
import java.util.concurrent.TimeUnit;

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
	// Make sure that the default ports are the same for Server and Generator
	private static final String DEFAULT_PORT = "80"; //$NON-NLS-1$
	public static final String SERVER_STOPPED_EVENT = "server_has_stopped"; //$NON-NLS-1$
	public static final String SERVER_STARTED_EVENT = "server_has_started"; //$NON-NLS-1$
	public static final String SERVER_STARTED_WITH_EXCEPTION_EVENT = "server_has_started_with_exceptions"; //$NON-NLS-1$
	private Server server;
	private final Logger logger = LoggerFactory.getLogger(ServerController.class);
	private WebAppContext root;
	static LocalPropertiesService localPropertiesService = new LocalPropertiesService();

	public WebApplicationContext getContext() {
		WebApplicationContext webApplicationContext = null;
		try {
			webApplicationContext = WebApplicationContextUtils.getRequiredWebApplicationContext(getRoot().getServletContext());
		} catch (Exception e) {
			e.printStackTrace();
			logger.error("Error getting web application context", e); //$NON-NLS-1$
		}
		return webApplicationContext;
	}

	private static String getDbURL() {
		// jdbc:postgresql://hostname:port/dbname
		final CollectDBDriver collectDBDriver = localPropertiesService.getCollectDBDriver();
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

	private void initilizeDataSources() {

		try {
			final File jettyAppCtxTemplateSrc = new File("resources/applicationContext.fmt"); //$NON-NLS-1$
			final File jettyAppCtxDst = new File(EarthConstants.GENERATED_FOLDER + "/applicationContext.xml"); //$NON-NLS-1$
			
			jettyAppCtxDst.getParentFile().mkdirs();
			
			final Map<String, String> data = new java.util.HashMap<String, String>();

			data.put("driver", localPropertiesService.getCollectDBDriver().getDriverClass()); //$NON-NLS-1$
			data.put("url", getDbURL()); //$NON-NLS-1$
			data.put("urlSaiku", getSaikuDbURL()); //$NON-NLS-1$
			data.put("username", localPropertiesService.getValue(EarthProperty.DB_USERNAME)); //$NON-NLS-1$
			data.put("password", localPropertiesService.getValue(EarthProperty.DB_PASSWORD)); //$NON-NLS-1$
			data.put("collectEarthExecutionFolder", System.getProperty("user.dir") + File.separator); //$NON-NLS-1$ //$NON-NLS-2$

			FreemarkerTemplateUtils.applyTemplate(jettyAppCtxTemplateSrc, jettyAppCtxDst, data);
		} catch (IOException | TemplateException e) {
			e.printStackTrace();
			logger.error("Error refreshing teh Jetty application context to add the data sources for Collect Earth", e); //$NON-NLS-1$
		}

	}

	public static String getSaikuDbURL() {
		String urlSaikuDB = getDbURL();

		if (localPropertiesService.isUsingSqliteDB()) {
			urlSaikuDB += SAIKU_RDB_SUFFIX;
		}
		return urlSaikuDB;
	}


	public void startServer(Observer observeInitialization) throws Exception {

		this.addObserver(observeInitialization);

		initilizeDataSources();
		try {

			final String webappDirLocation = FolderFinder.getLocalFolder();

			// The port that we should run on can be set into an environment variable
			// Look for that variable and default to 8080 if it isn't there.
			// PropertyConfigurator.configure(this.getClass().getResource("/WEB-INF/conf/log4j.properties"));

			server = new Server(new ExecutorThreadPool(10, 50, 5, TimeUnit.SECONDS));

			// // Use blocking-IO connector to improve throughput
			final ServerConnector connector = new ServerConnector(server);
			connector.setName("127.0.0.1:" + getPort()); //$NON-NLS-1$
			connector.setHost("0.0.0.0"); //$NON-NLS-1$
			connector.setPort(getPort());

			connector.setStopTimeout(1000);

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
				logger.error("Error creating the database connection", attribute); //$NON-NLS-1$
				notifyObservers(SERVER_STARTED_WITH_EXCEPTION_EVENT);
			} else {

				notifyObservers(SERVER_STARTED_EVENT);
			}
		} catch (final IOException e) {
			logger.error("Error initializing local properties", e); //$NON-NLS-1$
		} catch (Exception e) {
			logger.error("Error staring the server", e); //$NON-NLS-1$
		}

		// Force the local properties to be loaded before the browserservice is instantiated!! DO NOT REMOVE
		//LocalPropertiesService localPropertiesService = getContext().getBean(LocalPropertiesService.class);
		this.addObserver(getContext().getBean(BrowserService.class));
		//Force the initialization of backup service
		//getContext().getBean( BackupSqlLiteService.class);

		//server.join();
	}

	public void stopServer() throws Exception {
		if (server != null && server.isRunning()) {
			server.stop();
			setChanged();
			notifyObservers(SERVER_STOPPED_EVENT);
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

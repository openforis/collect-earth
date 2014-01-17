package org.openforis.collect.earth.app.desktop;

import java.io.IOException;
import java.net.Socket;
import java.util.Observable;
import java.util.Observer;
import java.util.concurrent.TimeUnit;

import org.eclipse.jetty.server.Connector;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.bio.SocketConnector;
import org.eclipse.jetty.util.thread.ExecutorThreadPool;
import org.eclipse.jetty.webapp.WebAppContext;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.context.support.WebApplicationContextUtils;

/**
 * Controls the Jetty server, starting and stopping it as well as reporting its staus. 
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class ServerController extends Observable {

	// Make sure that the default ports are the same for Server and Generator
	private static final String DEFAULT_PORT = "80";
	private Server server;
	private final Logger logger = LoggerFactory.getLogger(ServerController.class);
	private WebAppContext root;

	public WebApplicationContext getContext() {
		return WebApplicationContextUtils.getRequiredWebApplicationContext(getRoot().getServletContext());
	}

	private int getPort() {

		LocalPropertiesService localPropertiesService = new LocalPropertiesService();
		try {
			localPropertiesService.init();
		} catch (IOException e) {
			logger.error("Error initializing local properties", e);
		}

		String webPort = localPropertiesService.getPort();
		if (webPort == null || webPort.isEmpty()) {
			webPort = DEFAULT_PORT;
		}
		return Integer.parseInt(webPort);
	}

	public WebAppContext getRoot() {
		return root;
	}

	public boolean isServerAlreadyRunning() {
		boolean alreadyRunning = false;
		try {
			new Socket("localhost", getPort()).close();
			// If here there is something is serving on port 8888
			// So stop it
			logger.warn("There is a server already running " + getPort());
			alreadyRunning = true;
		} catch (IOException e) {
			// Nothing there, so OK to proceed
			logger.info("There is no server running in port " + getPort());
			alreadyRunning = false;
		}
		return alreadyRunning;
	}

	public void setRoot(WebAppContext root) {
		this.root = root;
	}

	/**
	 * @param args
	 */
	public void startServer(Observer observeInitialition) throws Exception {

		this.addObserver(observeInitialition);

		String webappDirLocation = "";

		// The port that we should run on can be set into an environment  variable
		// Look for that variable and default to 8080 if it isn't there.
		// PropertyConfigurator.configure(this.getClass().getResource("/WEB-INF/conf/log4j.properties"));

		server = new Server();
		// // Use blocking-IO connector to improve throughput
		Connector connector = new SocketConnector();
		connector.setPort(getPort());
		connector.setMaxIdleTime(10000);
		((SocketConnector) connector).setAcceptQueueSize(30000);
		server.setConnectors(new Connector[] { connector });

		server.setThreadPool(new ExecutorThreadPool(10, 50, 5, TimeUnit.SECONDS));

		setRoot(new WebAppContext());

		getRoot().setContextPath("/earth");
		
		getRoot().setDescriptor(this.getClass().getResource("/WEB-INF/web.xml").toURI().toString());
		getRoot().setResourceBase(webappDirLocation);

		// Parent loader priority is a class loader setting that Jetty accepts.
		// By default Jetty will behave like most web containers in that it will
		// allow your application to replace non-server libraries that are part of the container. 
		// Setting parent loader priority to true changes this behaviour.
		// Read more here:
		// http://wiki.eclipse.org/Jetty/Reference/Jetty_Classloading
		getRoot().setParentLoaderPriority(true);

		server.setHandler(getRoot());

		server.setGracefulShutdown(1000);
		server.setStopAtShutdown(true);
		server.start();

		setChanged();
		notifyObservers();

		server.join();
	}

	public void stopServer() throws Exception {
		if (server != null && server.isRunning()) {
			server.stop();
		}
	}

}

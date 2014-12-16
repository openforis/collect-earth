package org.openforis.collect.earth.app.desktop;

import java.io.File;
import java.io.IOException;
import java.net.Socket;
import java.util.concurrent.TimeUnit;

import javax.annotation.PostConstruct;

import org.eclipse.jetty.server.Connector;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;
import org.eclipse.jetty.util.thread.ExecutorThreadPool;
import org.eclipse.jetty.webapp.WebAppContext;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.context.support.WebApplicationContextUtils;

/**
 * Control the Collect Designer server (starts/stops the server as it is needed).
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Component
public class CollectDesignerController {

	private static final int DEFAULT_PORT = 8111;
	
	
	private final Logger logger = LoggerFactory.getLogger(CollectDesignerController.class);
	private WebAppContext root;
	
	@Autowired
	static LocalPropertiesService localPropertiesService;

	public WebApplicationContext getContext() {
		return WebApplicationContextUtils.getRequiredWebApplicationContext(getRoot().getServletContext());
	}


	private WebAppContext getRoot() {
		return root;
	}

	public boolean isServerAlreadyRunning() {
		boolean alreadyRunning = false;
		try {
			new Socket("127.0.0.1", getPort()).close(); //$NON-NLS-1$
			// If here there is something is serving on port 8888
			// So stop it
			logger.warn("There is a server already running " + getPort()); //$NON-NLS-1$
			alreadyRunning = true;
		} catch (final IOException e) {
			// Nothing there, so OK to proceed
			logger.info("There is no server running in port " + getPort()); //$NON-NLS-1$
			alreadyRunning = false;
		}
		return alreadyRunning;
	}

	private int getPort() {
		// TODO Auto-generated method stub
		return DEFAULT_PORT;
	}

	

	@PostConstruct
	public void startServer() throws Exception {
	 
	        Server designerServer = new Server(new ExecutorThreadPool(10, 50, 5, TimeUnit.SECONDS));
			

			// // Use blocking-IO connector to improve throughput
			final ServerConnector connector = new ServerConnector(designerServer);
			
			connector.setHost("0.0.0.0"); //$NON-NLS-1$
			connector.setPort( getPort() );

			connector.setStopTimeout( 1000 );
			
			designerServer.setConnectors(new Connector[] { connector });
	 
	        WebAppContext webapp = new WebAppContext();
	        webapp.setContextPath("/designer"); //$NON-NLS-1$
	        File war = new File("./resources/collectweb.war"); //$NON-NLS-1$
	        webapp.setWar( war.getAbsolutePath() );
	        designerServer.setHandler(webapp);
	 

		designerServer.setStopAtShutdown(true);
		designerServer.start();
		
		designerServer.join();
	}


}

package org.openforis.eye.springversion;

import java.io.IOException;
import java.net.Socket;
import java.util.Observable;
import java.util.Observer;

import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.webapp.WebAppContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 
 * This class launches the web application in an embedded Jetty container.
 * This is the entry point to your application. The Java command that is used for
 * launching should fire this main method.
 *
 */
public class ServerInitilizer extends Observable {
    
	private static final String DEFAULT_PORT = "8093";
	public static final String PLACEMARK_ID = "gePlacemarkId";

	private final Logger logger = LoggerFactory.getLogger(ServerInitilizer.class);

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

	/**
	 * @param args
	 */
	public void startServer(Observer observeInitialition) throws Exception {
		
		this.addObserver(observeInitialition);
		
		String webappDirLocation = "";

        
        //The port that we should run on can be set into an environment variable
        //Look for that variable and default to 8080 if it isn't there.
		// PropertyConfigurator.configure(this.getClass().getResource("/WEB-INF/conf/log4j.properties"));

		Server server = new Server(getPort());

        WebAppContext root = new WebAppContext();

		root.setContextPath("/eye");
		root.setDescriptor(this.getClass().getResource("/WEB-INF/web.xml").toURI().toString());
        root.setResourceBase(webappDirLocation);
        
        //Parent loader priority is a class loader setting that Jetty accepts.
        //By default Jetty will behave like most web containers in that it will
        //allow your application to replace non-server libraries that are part of the
        //container. Setting parent loader priority to true changes this behavior.
        //Read more here: http://wiki.eclipse.org/Jetty/Reference/Jetty_Classloading
        root.setParentLoaderPriority(true);

		server.setHandler(root);

		// System.setProperty("java.naming.factory.url.pkgs",
		// "org.eclipse.jetty.jndi");
		// System.setProperty("java.naming.factory.initial",
		// "org.eclipse.jetty.jndi.InitialContextFactory");
		//
		// EnvConfiguration envConfiguration = new EnvConfiguration();
		// URL url = new File(webappDirLocation +
		// "/META-INF/jetty-env.xml").toURI().toURL();
		// envConfiguration.setJettyEnvXml(url);
		//
		// root.setConfigurations(new Configuration[] { new
		// WebInfConfiguration(), envConfiguration, new WebXmlConfiguration()
		// });



		server.start();
        

		setChanged();
		notifyObservers();

        
        server.join();   
    }

	private int getPort() {
		String webPort = System.getenv("PORT");
		if (webPort == null || webPort.isEmpty()) {
			webPort = DEFAULT_PORT;
		}
		return Integer.parseInt(webPort);
	}

}

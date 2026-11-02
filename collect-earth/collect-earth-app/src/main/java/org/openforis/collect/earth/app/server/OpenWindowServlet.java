package org.openforis.collect.earth.app.server;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.desktop.AppShell;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Opens the window of the running Collect Earth when it is started again (EarthApp.openWindowInRunningCollectEarth):
 * what the tray icon's Open does, for the desktops that have no tray, where a closed home page could not be opened
 * again otherwise, and for everyone who starts Collect Earth from its shortcut to get its window back.
 */
@Controller
public class OpenWindowServlet {

	public static final String SERVLET_NAME = "openWindow"; //$NON-NLS-1$

	private final Logger logger = LoggerFactory.getLogger(OpenWindowServlet.class);
	private final Runnable openWindow;

	@Autowired
	public OpenWindowServlet(AppShell shell) {
		this(shell::openInBackground);
	}

	OpenWindowServlet(Runnable openWindow) {
		this.openWindow = openWindow;
	}

	@GetMapping("/" + SERVLET_NAME)
	public void processRequest(HttpServletRequest request, HttpServletResponse response) {
		if (!LocalClients.isOtherCollectEarth(request)) {
			logger.warn("Rejected a request from {} to open the window", request.getRemoteAddr()); //$NON-NLS-1$
			response.setStatus(HttpServletResponse.SC_FORBIDDEN);
			return;
		}
		// The browser takes seconds to open: answered first, the window opens on a thread of its own
		response.setStatus(HttpServletResponse.SC_ACCEPTED);
		openWindow.run();
	}
}

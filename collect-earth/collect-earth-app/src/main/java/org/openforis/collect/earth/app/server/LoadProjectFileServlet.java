package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Enumeration;
import java.util.Locale;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.swing.SwingUtilities;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Servlet to load a project file when Collect Earth is already running:
 *
 * If the user double-clicks on a project file, Collect Earth will first check
 * if there is already another instance running, if it is, then send a HTTP
 * request and quit. This servlet will receive the HTTP request and load the
 * project.
 *
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Controller
public class LoadProjectFileServlet {

	public static final String PROJECT_FILE_PARAMETER = "projectFilePath"; //$NON-NLS-1$
	public static final String SERVLET_NAME = "loadProjectFile"; //$NON-NLS-1$
	private static final String PROJECT_FILE_EXTENSION = ".cep"; //$NON-NLS-1$
	private Logger logger = LoggerFactory.getLogger(LoadProjectFileServlet.class);

	@Autowired
	EarthProjectsService earthProjectsService;

	@Autowired
	LocalPropertiesService localPropertiesService;

	@GetMapping("/" + SERVLET_NAME)
	public void processRequest(HttpServletRequest request, HttpServletResponse response) {
		final String projectFilePath = request.getParameter(PROJECT_FILE_PARAMETER);
		if (StringUtils.isBlank(projectFilePath)) {
			logger.error("The {} parameter cannot be empty", PROJECT_FILE_PARAMETER); //$NON-NLS-1$
			response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
			return;
		}

		// This servlet loads a file from the local disk and restarts the application, and the server has no authentication.
		// The only legitimate caller is a second Collect Earth instance started in this same computer ( see EarthApp.openProjectFileInRunningCollectEarth )
		if (!isLoopbackRequest(request) || isSentByBrowser(request)) {
			logger.warn("Rejected a request from {} to load the project file {}", request.getRemoteAddr(), projectFilePath); //$NON-NLS-1$
			response.setStatus(HttpServletResponse.SC_FORBIDDEN);
			return;
		}

		final File projectZipFile = new File(projectFilePath);
		if (!projectZipFile.isFile() || !projectZipFile.getName().toLowerCase(Locale.ENGLISH).endsWith(PROJECT_FILE_EXTENSION)) {
			logger.error("Not a Collect Earth project file that can be loaded : {}", projectFilePath); //$NON-NLS-1$
			response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
			return;
		}

		// The project is loaded later, in the Swing thread, when this request is already finished and its response object may have been
		// recycled by Jetty. So answer now ( 202 Accepted ) and do not touch the response from the deferred task
		response.setStatus(HttpServletResponse.SC_ACCEPTED);

		SwingUtilities.invokeLater(() -> {
			try {
				if (earthProjectsService.loadCompressedProjectFile(projectZipFile)) {
					localPropertiesService.nullifyChecksumValues();
					// Re-generate KMZ
					new Thread(
							"Restarting server after double-clicking on CEP file : " + projectZipFile.getName()) { //$NON-NLS-1$
						@Override
						public void run() {
							EarthApp.restart();
						}

					}.start();
				}

			} catch (IllegalArgumentException | IOException e) {
				logger.error("Error loading the project file " + projectFilePath, e); //$NON-NLS-1$
			}
		});

	}

	private boolean isLoopbackRequest(HttpServletRequest request) {
		try {
			return InetAddress.getByName(request.getRemoteAddr()).isLoopbackAddress();
		} catch (UnknownHostException e) {
			logger.warn("Could not resolve the remote address " + request.getRemoteAddr(), e); //$NON-NLS-1$
			return false;
		}
	}

	/**
	 * A web page opened in this computer could also fire this request ( it is a plain GET ). Browsers identify themselves with
	 * these headers, the Java client used by Collect Earth sends none of them.
	 *
	 * The headers are read with getHeaders and not with getHeader because GoogleEarthHeaderFilter wraps every request and
	 * answers "*" to getHeader("Origin") when the request carries no Origin of its own, for the balloons of Google Earth.
	 * Through getHeader every request looks like it came from a browser, and no project file could ever be loaded.
	 */
	private boolean isSentByBrowser(HttpServletRequest request) {
		return hasHeader(request, "Origin") || hasHeader(request, "Sec-Fetch-Site") //$NON-NLS-1$ //$NON-NLS-2$
				|| hasHeader(request, "Referer"); //$NON-NLS-1$
	}

	private boolean hasHeader(HttpServletRequest request, String name) {
		Enumeration<String> values = request.getHeaders(name);
		return values != null && values.hasMoreElements();
	}

}

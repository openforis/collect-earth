package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;

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
	private Logger logger = LoggerFactory.getLogger(LoadProjectFileServlet.class);

	@Autowired
	EarthProjectsService earthProjectsService;

	@Autowired
	LocalPropertiesService localPropertiesService;

	@GetMapping("/" + SERVLET_NAME)
	public void processRequest(HttpServletRequest request, HttpServletResponse response) {
		String projectFilePath = request.getParameter(PROJECT_FILE_PARAMETER);
		if (StringUtils.isBlank(projectFilePath)) {
			logger.error("The " + PROJECT_FILE_PARAMETER + " parameter cannot be empty"); //$NON-NLS-1$ //$NON-NLS-2$
		} else {

			SwingUtilities.invokeLater(() -> {
				File projectZipFile = new File(projectFilePath);
				try {
					if (earthProjectsService.loadCompressedProjectFile(projectZipFile)) {
						localPropertiesService.nullifyChecksumValues();
						// Re-generate KMZ
						new Thread(
								"Restarting server after double-clicking on CEP file : " + projectZipFile.getName()) {
							@Override
							public void run() {
								EarthApp.restart();
							}

						}.start();
					}

				} catch (IllegalArgumentException | IOException e) {
					logger.error("Error loading the project file " + projectFilePath, e); //$NON-NLS-1$
					response.setStatus(500);
				}
			});

			response.setStatus(200);

		}

	}

}

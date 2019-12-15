package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Set;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.BrowserNotFoundException;
import org.openforis.collect.earth.app.service.BrowserService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * This servlet is called by the balloon (KML pop-up form) when it is open and the user has chosen to see the form in a separate browser
 * window.
 * In that case a special HTML is used whose sole purpose is to load an invisible iframe that calls the URL localhot/openInBrowser
 * This causes a new browser window to open and then the browser is redirected to another URL ( localhost/balloon ) that contains the actual HTML
 * form.
 * The functionality is used mostly for LINUX users due to the different bugs present in Google Earth for LINUX which makes the Bootstrap library
 * fail.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Controller
public class BalloonServlet extends DataAccessingServlet {

	@Autowired
	private BrowserService browserService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private RemoteWebDriver webKitDriver = null;
	
	private static final String BALLOON_EXTERNAL_URL = "balloon"; //$NON-NLS-1$

	private String buildGetParameters(Map<String, String[]> parameterMap) {
		final StringBuilder getParameters = new StringBuilder();
		final Set<Entry<String, String[]>> entrySet = parameterMap.entrySet();
		for (final Entry<String, String[]> entry : entrySet) {
			getParameters.append(entry.getKey()).append("=").append(entry.getValue()[0]).append("&"); //$NON-NLS-1$ //$NON-NLS-2$
		}
		return getParameters.toString();
	}

	@RequestMapping("/openInBrowser")
	private void openInBrowser(HttpServletResponse response, HttpServletRequest request, String imageName) throws IOException, URISyntaxException {
		String url = ServerController.getHostAddress(localPropertiesService.getHost(), localPropertiesService.getLocalPort());
		url = url + BALLOON_EXTERNAL_URL + "?" + buildGetParameters(request.getParameterMap()); //$NON-NLS-1$
		final String fUrl = url;
		final Thread openBrowser = new Thread("Open URL in browser : " + fUrl) {

			@Override
			public void run() {
				try {
					webKitDriver = browserService.navigateTo(fUrl, webKitDriver, false);
				} catch (BrowserNotFoundException e) {
					logger.error("No browser found", e); //$NON-NLS-1$
				}
			}
		};
		openBrowser.start();

	}

	private String replaceGoalsWithParameters(String htmlWithGoals, Map<String, String[]> parameterMap) {
		final Set<Entry<String, String[]>> entrySet = parameterMap.entrySet();
		for (final Entry<String, String[]> entry : entrySet) {
			htmlWithGoals = htmlWithGoals.replaceAll("\\$\\[" + entry.getKey() + "\\]", entry.getValue()[0]); //$NON-NLS-1$ //$NON-NLS-2$
		}
		return htmlWithGoals;
	}

	@RequestMapping("/"+BALLOON_EXTERNAL_URL)
	private void returnBalloon(HttpServletResponse response, HttpServletRequest request, String imageName) throws IOException, URISyntaxException {
		response.setHeader("Content-Type", "text/html"); //$NON-NLS-1$ //$NON-NLS-2$
		response.setHeader("Content-Disposition", "inline; filename=\"" + imageName + "\""); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		response.setHeader("Cache-Control", "max-age=30"); //$NON-NLS-1$ //$NON-NLS-2$
		response.setHeader("Date", new SimpleDateFormat(EarthConstants.DATE_FORMAT_HTTP, Locale.ENGLISH).format(new Date())); //$NON-NLS-1$

		String balloonContents = FileUtils.readFileToString(new File(localPropertiesService.getBalloonFile()));

		if (balloonContents != null) {

			balloonContents = balloonContents.replaceAll(EarthConstants.FOLDER_COPIED_TO_KMZ + "/", EarthConstants.GENERATED_FOLDER_SUFFIX + "/" //$NON-NLS-1$ //$NON-NLS-2$
					+ EarthConstants.FOLDER_COPIED_TO_KMZ + "/"); //$NON-NLS-1$
			balloonContents = replaceGoalsWithParameters(balloonContents, request.getParameterMap());

			final byte[] bytes = balloonContents.getBytes();
			response.setHeader("Content-Length", Integer.toString( bytes.length ) ); //$NON-NLS-1$ //$NON-NLS-2$
			writeToResponse(response, bytes);

		} else {
			getLogger().error("There was a problem fetching the balloon html, please check the name!"); //$NON-NLS-1$
		}
	}

	private void writeToResponse(HttpServletResponse response, byte[] fileContents) throws IOException {
		try {
			response.getOutputStream().write(fileContents);
		} catch (final Exception e) {
			getLogger().error("Error writing reponse body to output stream ", e); //$NON-NLS-1$
		} finally {
			response.getOutputStream().close();
		}

	}
}

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
import org.openforis.collect.earth.app.service.BrowserService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.PreloadedFilesService;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
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

	@Autowired
	private PreloadedFilesService preloadedFilesService;

	private static RemoteWebDriver webKitDriver = null;
	
	private static final String BALLOON_EXTERNAL_URL = "balloon";

	private String buildGetParameters(Map<String, String[]> parameterMap) {
		final StringBuilder getParameters = new StringBuilder();
		final Set<Entry<String, String[]>> entrySet = parameterMap.entrySet();
		for (final Entry<String, String[]> entry : entrySet) {
			getParameters.append(entry.getKey()).append("=").append(entry.getValue()[0]).append("&");
		}
		return getParameters.toString();
	}

	@SuppressWarnings("unchecked")
	@RequestMapping("/openInBrowser")
	private void openInBrowser(HttpServletResponse response, HttpServletRequest request, String imageName) throws IOException, URISyntaxException {
		String url = KmlGenerator.getHostAddress(localPropertiesService.getHost(), localPropertiesService.getPort());
		url = url + BALLOON_EXTERNAL_URL + "?" + buildGetParameters(request.getParameterMap());
		final String fUrl = url;
		final Thread openBrowser = new Thread() {

			@Override
			public void run() {
				webKitDriver = browserService.navigateTo(fUrl, webKitDriver);
			};
		};
		openBrowser.start();

	}

	private String replaceGoalsWithParameters(String htmlWithGoals, Map<String, String[]> parameterMap) {
		final Set<Entry<String, String[]>> entrySet = parameterMap.entrySet();
		for (final Entry<String, String[]> entry : entrySet) {
			htmlWithGoals = htmlWithGoals.replaceAll("\\$\\[" + entry.getKey() + "\\]", entry.getValue()[0]);
		}
		return htmlWithGoals;
	}

	@SuppressWarnings("unchecked")
	@RequestMapping("/"+BALLOON_EXTERNAL_URL)
	private void returnBalloon(HttpServletResponse response, HttpServletRequest request, String imageName) throws IOException, URISyntaxException {
		response.setHeader("Content-Type", "text/html");
		response.setHeader("Content-Disposition", "inline; filename=\"" + imageName + "\"");
		response.setHeader("Cache-Control", "max-age=30");
		response.setHeader("Date", new SimpleDateFormat(EarthConstants.DATE_FORMAT_HTTP, Locale.ENGLISH).format(new Date()));

		String balloonContents = FileUtils.readFileToString(new File(localPropertiesService.getBalloonFile()));

		if (balloonContents != null) {

			balloonContents = balloonContents.replaceAll(EarthConstants.FOLDER_COPIED_TO_KMZ + "/", EarthConstants.GENERATED_FOLDER + "/"
					+ EarthConstants.FOLDER_COPIED_TO_KMZ + "/");
			balloonContents = replaceGoalsWithParameters(balloonContents, request.getParameterMap());

			final byte[] bytes = balloonContents.getBytes();
			response.setHeader("Content-Length", bytes.length + "");
			writeToResponse(response, bytes);

		} else {
			getLogger().error("There was a problem fetching the balloon html, please check the name!");
		}
	}

	private void writeToResponse(HttpServletResponse response, byte[] fileContents) throws IOException {
		try {
			response.getOutputStream().write(fileContents);
		} catch (final Exception e) {
			getLogger().error("Error writing reponse body to output stream ", e);
		} finally {
			response.getOutputStream().close();
		}

	}
}

package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Map;
import java.util.Set;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.BrowserService;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.PreloadedFilesService;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
public class BalloonServlet extends DataAccessingServlet {

	@Autowired
	private BrowserService browserService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private PreloadedFilesService preloadedFilesService;

	private static RemoteWebDriver webKitDriver = null;

	private String buildGetParameters(Map<String, String[]> parameterMap) {
		Set<String> keySet = parameterMap.keySet();
		String getParameters = "";
		for (String key : keySet) {
			getParameters += key + "=" + parameterMap.get(key)[0] + "&";
		}
		return getParameters;
	}
	
	private String replaceGoalsWithParameters(String htmlWithGoals, Map<String, String[]> parameterMap) {
		Set<String> keySet = parameterMap.keySet();
		for (String key : keySet) {
			htmlWithGoals = htmlWithGoals.replaceAll("\\$\\[" + key + "\\]", parameterMap.get(key)[0]);
		}
		return htmlWithGoals;
	}

	@RequestMapping("/openInBrowser")
	private void openInBrowser(HttpServletResponse response, HttpServletRequest request, String imageName) throws IOException,
			URISyntaxException {
		String url = KmlGenerator.getHostAddress(localPropertiesService.getHost(), localPropertiesService.getPort());
		url = url + "balloon?" + buildGetParameters(request.getParameterMap());
		final String fUrl = url;
		Thread openBrowser = new Thread() {

			public void run() {
				webKitDriver = browserService.navigateTo(fUrl, webKitDriver);
			};
		};
		openBrowser.start();

	}
	
	@RequestMapping("/balloon")
	private void returnBalloon(HttpServletResponse response, HttpServletRequest request, String imageName) throws IOException,
			URISyntaxException {
		response.setHeader("Content-Type", "text/html");
		response.setHeader("Content-Disposition", "inline; filename=\"" + imageName + "\"");
		response.setHeader("Cache-Control", "max-age=30");
		response.setHeader("Date", new SimpleDateFormat(EarthConstants.DATE_FORMAT_HTTP).format(new Date()));

		String balloonContents = FileUtils.readFileToString(new File(localPropertiesService.getBalloonFile()));

		if (balloonContents != null) {

			balloonContents = balloonContents.replaceAll( "earthFiles/", EarthApp.GENERATED_FOLDER + "/earthFiles/");
			balloonContents = replaceGoalsWithParameters(balloonContents, request.getParameterMap());

			byte[] bytes = balloonContents.getBytes();
			response.setHeader("Content-Length", bytes.length + "");
			writeToResponse(response, bytes);

		} else {
			getLogger().error("There was a problem fetching the balloon html, please check the name!");
		}
	}

	private void writeToResponse(HttpServletResponse response, byte[] fileContents) throws IOException {
		try {
			response.getOutputStream().write(fileContents);
		} catch (Exception e) {
			getLogger().error("Error writing reponse body to output stream ", e);
		} finally {
			response.getOutputStream().close();
		}

	}
}

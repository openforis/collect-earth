package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URISyntaxException;
import java.util.Date;
import java.util.Map;

import javax.servlet.ServletContext;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.PreloadedFilesService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class PlacemarkImageServlet extends DataAccessingServlet {


	@Autowired
	EarthSurveyService earthSurveyService;

	@Autowired
	PreloadedFilesService preloadedFilesService;

	@RequestMapping("/placemarkIcon")
	public void getImage(HttpServletResponse response, HttpServletRequest request,
			@RequestParam("collect_text_id") String placemarkId,
			@RequestParam(value = "listView", required = false) Boolean listView)
			throws IOException, URISyntaxException {

		if (listView == null) {
			listView = Boolean.FALSE;
		}

		// Check if placemark already filled
		// , @RequestParam String gePlacemarkId
		// String gePlacemarkId = "";
		getLogger().info("Trying to load icon for placemark with id : " + placemarkId);

		Map<String, String> placemarkParameters = earthSurveyService.getPlacemark(placemarkId);
		String imageName = "";

		if (earthSurveyService.isPlacemarSavedActively(placemarkParameters)) {
			if (listView) {
				imageName = EarthConstants.LIST_FILLED_IMAGE;
			} else {
				imageName = EarthConstants.FILLED_IMAGE;
			}
		} else {
			if (listView) {
				imageName = EarthConstants.LIST_NON_FILLED_IMAGE;
			} else {
				imageName = EarthConstants.NON_FILLED_IMAGE;
			}
		}
		returnImage(response, request, imageName);
	}

	private byte[] readFile(String filePath, ServletContext servletContext) throws MalformedURLException, URISyntaxException {

		File imageFile = new File(servletContext.getResource(filePath).toURI());
		return preloadedFilesService.getFileContent(imageFile);
	}

	private void returnImage(HttpServletResponse response, HttpServletRequest request, String imageName) throws IOException,
			URISyntaxException {
		response.setHeader("Content-Type", "image/png");
		response.setHeader("Content-Disposition", "inline; filename=\"" + imageName + "\"");
		response.setHeader("Cache-Control", "max-age=30");
		response.setHeader("Date", EarthConstants.DATE_FORMAT_HTTP.format(new Date()));

		byte[] resultingImage = null;
		if (imageName.equals(EarthConstants.FILLED_IMAGE)) {
			resultingImage = readFile(EarthConstants.FILLED_IMAGE, request.getSession().getServletContext());
		} else if (imageName.equals(EarthConstants.NON_FILLED_IMAGE)) {
			resultingImage = readFile(EarthConstants.NON_FILLED_IMAGE, request.getSession().getServletContext());
		} else if (imageName.equals(EarthConstants.LIST_NON_FILLED_IMAGE)) {
			resultingImage = readFile(EarthConstants.LIST_NON_FILLED_IMAGE, request.getSession().getServletContext());
		} else if (imageName.equals(EarthConstants.LIST_FILLED_IMAGE)) {
			resultingImage = readFile(EarthConstants.LIST_FILLED_IMAGE, request.getSession().getServletContext());
		}
		if (resultingImage != null) {
			response.setHeader("Content-Length", resultingImage.length + "");
			writeToResponse(response, resultingImage);
		} else {
			getLogger().error("There was a problem fetching the image, please check the name!");
		}
	}

	private void writeToResponse(HttpServletResponse response, byte[] fileContents) throws IOException {
		response.getOutputStream().write(fileContents);
		response.getOutputStream().close();
	}
}

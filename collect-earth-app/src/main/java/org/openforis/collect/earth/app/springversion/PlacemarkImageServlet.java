package org.openforis.collect.earth.app.springversion;

import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URISyntaxException;
import java.util.Map;

import javax.servlet.ServletContext;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class PlacemarkImageServlet extends DataAccessingServlet {

	private static final String FILLED_IMAGE = "/images/redTransparent.png";

	private static final String NON_FILLED_IMAGE = "/images/transparent.png";

	private static final String LIST_FILLED_IMAGE = "/images/list_filled.png";

	private static final String LIST_NON_FILLED_IMAGE = "/images/list_empty.png";

	private byte[] filledImage;

	private byte[] nonFilledImage;

	private byte[] listFilledImage;

	private byte[] listNonFilledImage;

	@Autowired
	EarthSurveyService earthSurveyService;

	@RequestMapping("/placemarkIcon")
	public void getImage(HttpServletResponse response, HttpServletRequest request,
			@RequestParam("collect_text_id") String placemarkId,
			@RequestParam(value = "listView", required = false) Boolean listView)
			throws IOException, URISyntaxException {

		if (listView == null) {
			listView = Boolean.FALSE;
		}

		if (filledImage == null) {
			filledImage = readFile(FILLED_IMAGE, request.getSession().getServletContext());
			nonFilledImage = readFile(NON_FILLED_IMAGE, request.getSession().getServletContext());
			listFilledImage = readFile(LIST_FILLED_IMAGE, request.getSession().getServletContext());
			listNonFilledImage = readFile(LIST_NON_FILLED_IMAGE, request.getSession().getServletContext());
		}

		// Check if placemark already filled
		// , @RequestParam String gePlacemarkId
		// String gePlacemarkId = "";
		getLogger().info("Trying to load icon for placemark with id : " + placemarkId);

		Map<String, String> placemarkParameters = earthSurveyService.getPlacemark(placemarkId);
		String imageName = "";

		if (earthSurveyService.isPlacemarSavedActively(placemarkParameters)) {
			if (listView) {
				imageName = LIST_FILLED_IMAGE;
			} else {
				imageName = FILLED_IMAGE;
			}
		} else {
			if (listView) {
				imageName = LIST_NON_FILLED_IMAGE;
			} else {
				imageName = NON_FILLED_IMAGE;
			}
		}
		returnImage(response, imageName);
	}

	private byte[] readFile(String filePath, ServletContext servletContext) throws MalformedURLException, URISyntaxException {

		File imageFile = new File(servletContext.getResource(filePath).toURI());
		byte fileContent[] = new byte[0];
		try {
			fileContent = FileUtils.readFileToByteArray(imageFile);
		} catch (IOException e) {
			getLogger().error("Problems while reading the file " + filePath + " was not found.", e);
		}
		return fileContent;
	}

	private void returnImage(HttpServletResponse response, String imageName) throws IOException {
		response.setHeader("Content-Type", "image/png");
		response.setHeader("Content-Disposition", "inline; filename=\"" + imageName + "\"");
		response.setHeader("Cache-Control", "max-age=30");

		byte[] resultingImage = null;
		if (imageName.equals(FILLED_IMAGE)) {
			resultingImage = filledImage;
		} else if (imageName.equals(NON_FILLED_IMAGE)) {
			resultingImage = nonFilledImage;
		} else if (imageName.equals(LIST_NON_FILLED_IMAGE)) {
			resultingImage = listNonFilledImage;
		} else if (imageName.equals(LIST_FILLED_IMAGE)) {
			resultingImage = listFilledImage;
		}

		response.setHeader("Content-Length", resultingImage.length + "");
		writeToResponse(response, resultingImage);
	}

	private void writeToResponse(HttpServletResponse response, byte[] fileContents) throws IOException {
		response.getOutputStream().write(fileContents);
		response.getOutputStream().close();
	}
}

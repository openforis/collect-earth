package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URISyntaxException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
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

/**
 * Servlet used to obtain the right icon/ground-overlay for each placemark.
 * These icons symbolize the status of a placemark ( a red exclamation if the placemark has not been filled, a yellow warning sign if the placemark is
 * partially filled or a green tick if the placemark information has been successfully filled)
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Controller
public class PlacemarkImageServlet extends DataAccessingServlet {

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private PreloadedFilesService preloadedFilesService;

	/**
	 * Returns an icon/overlay image that represents the state of the placemark not-filled/filling/filled
	 * @param response
	 * @param request
	 * @param placemarkId The ID of the placemark for which we want to get the icon/overlay
	 * @param listView True if want to get the icon for the placemark list, false to get the overlay image (transparent or see-through red for filled placemarks)
	 * @throws IOException
	 * @throws URISyntaxException
	 */
	@RequestMapping("/placemarkIcon")
	public void getImage(HttpServletResponse response, HttpServletRequest request, @RequestParam("collect_text_id") String placemarkId,
			@RequestParam(value = "listView", required = false) Boolean listView) throws IOException, URISyntaxException {
			
		final Map<String, String> placemarkParameters = earthSurveyService.getPlacemark(placemarkId);
		String imageName = "";

		if (earthSurveyService.isPlacemarSavedActively(placemarkParameters)) {
			if (listView != null && listView) {
				imageName = EarthConstants.LIST_FILLED_IMAGE;
			} else {
				imageName = EarthConstants.FILLED_IMAGE;
			}
		} else if (earthSurveyService.isPlacemarEdited(placemarkParameters)) {
			if (listView != null && listView) {
				imageName = EarthConstants.LIST_NOT_FINISHED_IMAGE;
			} else {
				imageName = EarthConstants.NON_FILLED_IMAGE;
			}
		} else {
			if (listView != null && listView) {
				imageName = EarthConstants.LIST_NON_FILLED_IMAGE;
			} else {
				imageName = EarthConstants.NON_FILLED_IMAGE;
			}
		}
		returnImage(response, request, imageName);
	}

	private byte[] readFile(String filePath, ServletContext servletContext) throws MalformedURLException, URISyntaxException {
		final File imageFile = new File(servletContext.getResource(filePath).toURI());
		return preloadedFilesService.getFileContent(imageFile);
	}

	private void returnImage(HttpServletResponse response, HttpServletRequest request, String imageName) throws IOException, URISyntaxException {
		
		response.setHeader("Content-Type", "image/png");
		response.setHeader("Content-Disposition", "inline; filename=\"" + imageName + "\"");
		response.setHeader("Cache-Control", "max-age=30");
		response.setHeader("Date", new SimpleDateFormat(EarthConstants.DATE_FORMAT_HTTP, Locale.ENGLISH).format(new Date()));

		byte[] resultingImage = null;
		if (imageName.equals(EarthConstants.FILLED_IMAGE)) {
			resultingImage = readFile(EarthConstants.FILLED_IMAGE, request.getSession().getServletContext());
		} else if (imageName.equals(EarthConstants.NON_FILLED_IMAGE)) {
			resultingImage = readFile(EarthConstants.NON_FILLED_IMAGE, request.getSession().getServletContext());
		} else if (imageName.equals(EarthConstants.LIST_NON_FILLED_IMAGE)) {
			resultingImage = readFile(EarthConstants.LIST_NON_FILLED_IMAGE, request.getSession().getServletContext());
		} else if (imageName.equals(EarthConstants.LIST_FILLED_IMAGE)) {
			resultingImage = readFile(EarthConstants.LIST_FILLED_IMAGE, request.getSession().getServletContext());
		} else if (imageName.equals(EarthConstants.LIST_NOT_FINISHED_IMAGE)) {
			resultingImage = readFile(EarthConstants.LIST_NOT_FINISHED_IMAGE, request.getSession().getServletContext());
		}
		
		if (resultingImage != null) {
			response.setHeader("Content-Length", resultingImage.length + "");
			writeToResponse(response, resultingImage);
		} else {
			getLogger().error("There was a problem fetching the image, please check the name!");
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

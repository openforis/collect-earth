package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URISyntaxException;
import java.security.Policy.Parameters;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
public class PlacemarkImageServlet extends JsonPocessorServlet {

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private PreloadedFilesService preloadedFilesService;
	
	private Logger logger = LoggerFactory.getLogger( PlacemarkImageServlet.class );

	/**
	 * Returns an icon/overlay image that represents the state of the placemark not-filled/filling/filled
	 * @param response The HTTP response object
	 * @param request The HTTP request object
	 * @param listView True if want to get the icon for the placemark list, false to get the overlay image (transparent or see-through red for filled placemarks)
	 * @throws IOException In case the image icon cannot be open
	 * @throws URISyntaxException In case the image icon URL contains an error
	 */
	@RequestMapping("/placemarkIcon")
	public void getImage(HttpServletResponse response, HttpServletRequest request, 
			@RequestParam(value = "listView", required = false) Boolean listView) throws IOException, URISyntaxException {

		if( listView == null ){
			throw new IllegalArgumentException("This servlet only responds to listView type of requests where the status icons for the placemarks are the expected result");
		}
		
		// If there is an exception while we get the record info (problem that might happen when using SQLite due to concurrency) return the yellow icon.
		String imageName = null;
		final Map<String, String> parameters = extractRequestData(request);
		try {
			
			final Map<String, String> placemarkParameters = earthSurveyService.getPlacemark(parameters);

			if (earthSurveyService.isPlacemarSavedActively(placemarkParameters)) {
				if (listView != null && listView) {
					imageName = EarthConstants.LIST_FILLED_IMAGE;
				} 
			} else if (earthSurveyService.isPlacemarEdited(placemarkParameters)) {
				if (listView != null && listView) {
					imageName = EarthConstants.LIST_NOT_FINISHED_IMAGE;
				} 
			} else {
				if (listView != null && listView) {
					imageName = EarthConstants.LIST_NON_FILLED_IMAGE;
				} 
			}
			
		} catch (Exception e) {
			logger.error("Error loading image for placemark with data " + parameters.toString() , e);
			System.out.println( e );
			// If there is an exception while we get the record info (problem that might happen when using SQLite due to concurrency) return the yellow icon.
			imageName = EarthConstants.LIST_NOT_FINISHED_IMAGE;
		}finally{
			returnImage(response, request, imageName);
		}
		
		
	}

	private byte[] readFile(String filePath, ServletContext servletContext) throws MalformedURLException, URISyntaxException {
		final File imageFile = new File(filePath);
		return preloadedFilesService.getFileContent(imageFile);
	}

	private void returnImage(HttpServletResponse response, HttpServletRequest request, String imageName) throws IOException, URISyntaxException {
		
		response.setHeader("Content-Type", "image/png");
		response.setHeader("Content-Disposition", "inline; filename=\"" + imageName + "\"");
		response.setHeader("Cache-Control", "max-age=30");
		response.setHeader("Date", new SimpleDateFormat(EarthConstants.DATE_FORMAT_HTTP, Locale.ENGLISH).format(new Date()));

		byte[] resultingImage = null;
		if (imageName.equals(EarthConstants.LIST_NON_FILLED_IMAGE)) {
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

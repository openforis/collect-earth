package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.util.Date;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.planet.DateUtils;
import org.openforis.collect.earth.planet.PlanetImagery;
import org.openforis.collect.earth.planet.PlanetRequestParameters;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

/**
 * Controller to load and store the information that is stored in Collect Earth
 * for one placemark (plot)
 *
 * @author Alfonso Sanchez-Paus Diaz
 * @author S. Ricci
 *
 */
@Controller
public class PlacemarkPlanetImagery extends JsonPocessorServlet {

	@Autowired
	LocalPropertiesService localPropertiesService;

	// 2015-07-17T10:50:18.650Z
	private SimpleDateFormat planetDateFormat = new SimpleDateFormat("yyyy-MM-dd");

	@CrossOrigin(origins = "*")
	@PostMapping(value = "/planetTileUrl")
	public void planetTileUrl(HttpServletRequest request, HttpServletResponse response)
			throws IOException, ParseException {

		PlanetRequestParameters params = getRequestParameters(request);

		PlanetImagery planetImagery = new PlanetImagery(localPropertiesService.getPlanetMapsKey());
		String tileUrl = planetImagery.getLayerUrl(params);

		setJsonResponse(response, tileUrl == null ? "" : tileUrl);
	}

	private PlanetRequestParameters getRequestParameters(HttpServletRequest request) throws ParseException {
		Date startDate = planetDateFormat.parse(request.getParameter("start"));
		Date endDate = getEndDate(request, startDate);

		double[][][] coords = getCoordinates(request);
		String[] itemTypeArray = getItemTypes(request);

		return new PlanetRequestParameters(startDate, endDate, coords, itemTypeArray);
	}

	private double[][][] getCoordinates(HttpServletRequest request) {
		Gson gson = new GsonBuilder().create();
		return gson.fromJson(request.getParameter("geometry"), double[][][].class);
	}

	private String[] getItemTypes(HttpServletRequest request) {
		String[] itemTypeArray = request.getParameterMap().get("itemTypes[]");
		if (itemTypeArray == null || itemTypeArray.length == 0) {
			itemTypeArray = new String[] { "PSScene3Band", "PSScene4Band" };
		}
		return itemTypeArray;
	}

	private Date getEndDate(HttpServletRequest request, Date startDate) throws ParseException {
		String endDateString = request.getParameter("end");
		Date endDate = null;
		if (StringUtils.isNotBlank(endDateString)) {
			endDate = planetDateFormat.parse(endDateString);
		} else {
			LocalDateTime localDateTime = DateUtils.asLocalDateTime(startDate);
			endDate = DateUtils.asDate(localDateTime.plusDays(30));
		}
		return endDate;
	}

	@CrossOrigin(origins = "*")
	@PostMapping(value = "/planetAvailableImagery")
	public void planetAvailableImagery(HttpServletRequest request, HttpServletResponse response)
			throws IOException, ParseException {

		PlanetRequestParameters params = getRequestParameters(request);

		PlanetImagery planetImagery = new PlanetImagery(localPropertiesService.getPlanetMapsKey());
		setJsonResponse(response, planetImagery.getAvailableDates(params));
	}

}

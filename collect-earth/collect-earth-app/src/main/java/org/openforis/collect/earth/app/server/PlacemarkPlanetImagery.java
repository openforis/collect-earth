package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.util.Date;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.lang.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.planet.DateUtils;
import org.openforis.collect.earth.planet.PlanetImagery;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PostMapping;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

/**
 * Controller to load and store the information that is stored in Collect Earth for one placemark (plot)
 *
 * @author Alfonso Sanchez-Paus Diaz
 * @author S. Ricci
 *
 */
@Controller
public class PlacemarkPlanetImagery extends JsonPocessorServlet {

	@Autowired
	LocalPropertiesService localPropertiesService;

	@PostMapping(value="/planetTileUrl")
	public void planetTileUrl(HttpServletRequest request,HttpServletResponse response) throws IOException, ParseException {

			//2015-07-17T10:50:18.650Z
			SimpleDateFormat sdf =new SimpleDateFormat("yyyy-MM-dd");
			Date startDate= sdf.parse( request.getParameter("start") );
			String endDateString= request.getParameter("end");
			Date endDate = null;
			if( StringUtils.isNotBlank( endDateString ) ) {
				endDate = sdf.parse( endDateString );
			}else {
				LocalDateTime localDateTime = DateUtils.asLocalDateTime( startDate );
				endDate = DateUtils.asDate( localDateTime.plusDays(30) );
			}

			PlanetImagery planetImagery = new PlanetImagery( localPropertiesService.getPlanetMapsKey() );

			Gson gson = new GsonBuilder().create();
			double[][][] coords = gson.fromJson( request.getParameter("geometry"), double[][][].class);

			String[] itemTypeArray = request.getParameterMap().get("itemTypes[]");
			if( itemTypeArray == null || itemTypeArray.length == 0 ) {
				itemTypeArray = new String[] {"PSScene3Band", "PSScene4Band"};
			}

			String tileUrl = planetImagery.getLayerUrl(startDate, endDate, coords, itemTypeArray);

			setJsonResponse(response, tileUrl==null?"":tileUrl);
	}

	@PostMapping(value="/planetAvailableImagery")
	public void planetAvailableImagery(HttpServletRequest request,HttpServletResponse response) throws IOException, ParseException {

			//2015-07-17T10:50:18.650Z
			SimpleDateFormat sdf =new SimpleDateFormat("yyyy-MM-dd");
			Date startDate= sdf.parse( request.getParameter("start") );
			String endDateString= request.getParameter("end");
			Date endDate = null;
			if( StringUtils.isNotBlank( endDateString ) ) {
				endDate = sdf.parse( endDateString );
			}else {
				LocalDateTime localDateTime = DateUtils.asLocalDateTime( startDate );
				endDate = DateUtils.asDate( localDateTime.plusDays(30) );
			}

			PlanetImagery planetImagery = new PlanetImagery( localPropertiesService.getPlanetMapsKey() );

			Gson gson = new GsonBuilder().create();
			double[][][] coords = gson.fromJson( request.getParameter("geometry"), double[][][].class);

			String[] itemTypeArray = request.getParameterMap().get("itemTypes[]");
			if( itemTypeArray == null || itemTypeArray.length == 0 ) {
				itemTypeArray = new String[] {"PSScene3Band", "PSScene4Band"};
			}

			setJsonResponse(response, planetImagery.getAvailableDates(startDate, endDate, coords, itemTypeArray));
	}

}

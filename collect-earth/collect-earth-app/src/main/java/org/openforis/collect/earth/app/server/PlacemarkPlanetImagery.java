package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.text.DateFormat;
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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

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

	@RequestMapping(value="/planet", method = RequestMethod.POST)
	public void planet(HttpServletRequest request,HttpServletResponse response) throws IOException {
		try {
			//2015-07-17T10:50:18.650Z
			SimpleDateFormat sdf =new SimpleDateFormat("yyyy-MM-dd");
			Date startDate= sdf.parse( request.getParameter("start").substring(1, 11) );
			String endDateString= request.getParameter("end");
			Date endDate = null;
			if( StringUtils.isNotBlank( endDateString ) ) {
				endDate = sdf.parse( endDateString.substring(1, 11) );
			}else {
				LocalDateTime localDateTime = DateUtils.asLocalDateTime( startDate );
				endDate = DateUtils.asDate( localDateTime.plusDays(30) );
			}

			PlanetImagery planetImagery = new PlanetImagery( localPropertiesService.getPlanetMapsKey() );
			
			Gson gson = new GsonBuilder().create();
			double[][][] coords = gson.fromJson( request.getParameter("geometry"), double[][][].class);
			
			String[] itemTypeArray = new String[] {"PSScene3Band", "PSScene4Band"};
			String itemTypes = request.getParameter("itemTypes");
			if( StringUtils.isNotBlank( itemTypes ) ) {
				itemTypeArray = gson.fromJson( itemTypes, String[].class);
			}
			
			setJsonResponse(response, planetImagery.getLayerUrl(startDate, endDate, coords, itemTypeArray));
		}catch(Exception e){
			logger.error("Error getting planet images url" , e);
		}
	}

}

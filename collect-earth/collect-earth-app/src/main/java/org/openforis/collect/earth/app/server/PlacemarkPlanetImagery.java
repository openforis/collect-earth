package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.text.DateFormat;
import java.text.ParseException;
import java.time.LocalDateTime;
import java.util.Date;

import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.planet.DateUtils;
import org.openforis.collect.earth.planet.PlanetImagery;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;

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

	private PlanetImagery planetImagery;

	@RequestMapping(value="/planet", method = RequestMethod.POST)
	//public void planet(@RequestParam("json") SearchRequest searchRequest, HttpServletResponse response) throws IOException {
	public void planet(@RequestParam("start") String start, @RequestParam("end") String end, @RequestParam("geometry") double[][][] coords,HttpServletResponse response) throws IOException {
		try {
			Date startDate= DateFormat.getDateInstance().parse( start );
			Date endDate= null;
			if( end.length() > 0 ) {

				endDate = DateFormat.getDateInstance().parse( start );

			}else {
				LocalDateTime localDateTime = DateUtils.asLocalDateTime( startDate );
				endDate = DateUtils.asDate( localDateTime.plusDays(30) );
			}

			planetImagery = new PlanetImagery( localPropertiesService.getPlanetMapsKey() );

			setJsonResponse(response, planetImagery.getLayerUrl(startDate, endDate, coords, new String[]{"PSScene3Band", "PSScene4Band"} ));
		}catch(Exception e){
			logger.error("Error getting planet images url" , e);
		}
	}

}

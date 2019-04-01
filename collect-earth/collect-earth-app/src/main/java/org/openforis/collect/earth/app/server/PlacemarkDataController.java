package org.openforis.collect.earth.app.server;

import java.io.IOException;

import javax.servlet.http.HttpServletResponse;

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
public class PlacemarkDataController extends AbstractPlacemarkDataController {
	@Override
	@RequestMapping(value="/placemark-info-expanded", method = RequestMethod.GET)
	protected void placemarkInfoExpanded(@RequestParam("id") String placemarkId, HttpServletResponse response) throws IOException {
		try{
			super.placemarkInfoExpanded(placemarkId, response);
		}catch(Exception e){
			logger.error("Error saving data" , e);
		}
	}

	@Override
	@RequestMapping(value="/save-data-expanded", method = RequestMethod.POST)
	public void saveDataExpanded(PlacemarkUpdateRequest updateRequest, HttpServletResponse response) throws IOException {
		try{
			super.saveDataExpanded(updateRequest, response);
		}catch(Exception e){
			logger.error("Error saving data" , e);
		}
	}

}

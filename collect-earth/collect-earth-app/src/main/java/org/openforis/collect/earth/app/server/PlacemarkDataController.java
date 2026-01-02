package org.openforis.collect.earth.app.server;

import java.io.IOException;

import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.logging.GAlogger;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
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
	@GetMapping(value="/placemark-info-expanded")
	public void placemarkInfoExpanded(@RequestParam("id") String placemarkId, HttpServletResponse response) throws IOException {
		try{
			super.placemarkInfoExpanded(placemarkId, response);
		}catch(Exception e){
			logger.error("Error saving data" , e);
		}
	}

	@Override
	@PostMapping(value="/save-data-expanded")
	public void saveDataExpanded(PlacemarkUpdateRequest updateRequest, HttpServletResponse response) throws IOException {
		try{
			super.saveDataExpanded(updateRequest, response);
			if( "true".equals(updateRequest.getValues().get("collect_boolean_actively_saved"))) {
				GAlogger.logGAnalytics("PlotSavedCollectEarth");
			}
		}catch(Exception e){
			logger.error("Error saving data" , e);
		}
	}

}

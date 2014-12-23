package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.CollectParametersHandlerService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * Servlet to return the information that is stored in Collect Earth for one placemark (plot)
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Controller
public class PlacemarkInfoServlet extends JsonPocessorServlet {

	private static final String PLACEMARK_ID = "collect_text_id";

	@Autowired
	EarthSurveyService earthSurveyService;

	/* 
	 * Returns a JSON object with the data colleted for a placemark in the collect-earth format.
	 * It also opens the extra browser windows for Earth Engine, Timelapse and Bing. 
	 * (non-Javadoc)
	 * @see org.openforis.collect.earth.app.server.JsonPocessorServlet#processRequest(javax.servlet.http.HttpServletRequest, javax.servlet.http.HttpServletResponse)
	 */
	@RequestMapping("/placemarkInfo")
	protected void processRequest(HttpServletRequest request, HttpServletResponse response) throws IOException {
		Map<String, String> parameters = extractRequestData(request);
		Map<String, String> dataInDB = null;
		String[] placemarkIdValues;
		try {
			
			placemarkIdValues = earthSurveyService.extractKeyValues(parameters);
			dataInDB = getDataAccessor().getData(parameters);
			
			if (dataInDB != null && dataInDB.get(EarthConstants.PLACEMARK_FOUND_PARAMETER) != null
					&& dataInDB.get(EarthConstants.PLACEMARK_FOUND_PARAMETER).equals("true")) {
				
				setResult(true, "The placemark was found", dataInDB);
				getLogger().info("A placemark was found with these properties" + dataInDB.toString());
				
			} else {
				
				if (dataInDB == null) {
					dataInDB = new HashMap<String, String>();
				}
				setResult(false, "No placemark found", parameters);
				getLogger().info("No placemark found " + parameters.toString());
				
			}
			
		} catch (Exception e) {

			setResult(false, "No placemark ID found in the request", parameters);
			getLogger().error("No placemark ID found in the received request");
		}
		

		setJsonResponse(response, dataInDB);

	}

}

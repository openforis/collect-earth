package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.BrowserService;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
public class PlacemarkInfoServlet extends JsonPocessorServlet {


	@Autowired
	private BrowserService browserService;
	private static final String PLACEMARK_ID = "collect_text_id";

	private String getPlacemarkId(Map<String, String> collectedData) {
		return collectedData.get(PlacemarkInfoServlet.PLACEMARK_ID);
	}

	@Override
	@RequestMapping("/placemarkInfo")
	protected void processRequest(HttpServletRequest request, HttpServletResponse response) throws IOException {
		Map<String, String> collectedData = extractRequestData(request);

		String placemarkId = getPlacemarkId(collectedData);

		final String originalLatLong = collectedData.get("collect_coord_location");

		if (placemarkId == null) {
			setResult(false, "No placemark ID found in the request", collectedData);
			getLogger().error("No placemark ID found in the received request");
		} else {

			if (placemarkId.equals("$[id]")) {
				placemarkId = "testPlacemark";
			}
			collectedData = getDataAccessor().getData(placemarkId);
			if (collectedData != null && collectedData.get(EarthConstants.PLACEMARK_FOUND_PARAMETER) != null
					&& collectedData.get(EarthConstants.PLACEMARK_FOUND_PARAMETER).equals("true")) {

				setResult(true, "The placemark was found", collectedData);
				getLogger().info("A placemark was found with these properties" + collectedData.toString());

			} else {
				if (collectedData == null) {
					collectedData = new HashMap<String, String>();
				}
				setResult(false, "No placemark found", collectedData);
				getLogger().info("No placemark found " + collectedData.toString());
			}

		}

		setJsonResponse(response, collectedData);

		try {
			browserService.openEarthEngine(originalLatLong);
			browserService.openTimelapse(originalLatLong);
			browserService.openBingMaps(originalLatLong);
		} catch (Exception e) {
			LoggerFactory.getLogger(this.getClass()).error("Exception", e);
		}

	}

}

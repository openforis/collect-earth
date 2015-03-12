package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.EarthConstants;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * Servlet to return the information that is stored in Collect Earth for one placemark (plot)
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 * @deprecated Replaced by {@link PlacemarkDataController}
 */
@Deprecated
@Controller
public class PlacemarkInfoServlet extends JsonPocessorServlet {

	public static final String PLACEMARK_ID_PARAMETER = "collect_text_id"; //$NON-NLS-1$


	/**
	 * Returns a JSON object with the data colleted for a placemark in the collect-earth format.
	 * @param request
	 * @param response
	 * @throws IOException
	 */
	@RequestMapping("/placemarkInfo")
	protected void placemarkInfoOld(HttpServletRequest request, HttpServletResponse response) throws IOException {
		Map<String, String> collectedData = extractRequestData(request);
		String placemarkId = getPlacemarkId(collectedData);
		
		if (placemarkId == null) {
			setResult(false, "No placemark ID found in the request", collectedData); //$NON-NLS-1$
			getLogger().error("No placemark ID found in the received request"); //$NON-NLS-1$
		} else {
			placemarkId = replacePlacemarkIdTestValue(placemarkId);
			collectedData = getDataAccessor().getData(placemarkId);
			if (collectedData != null && collectedData.get(EarthConstants.PLACEMARK_FOUND_PARAMETER) != null
					&& collectedData.get(EarthConstants.PLACEMARK_FOUND_PARAMETER).equals("true")) { //$NON-NLS-1$
				setResult(true, "The placemark was found", collectedData); //$NON-NLS-1$
				getLogger().info("A placemark was found with these properties" + collectedData.toString()); //$NON-NLS-1$
			} else {
				if (collectedData == null) {
					collectedData = new HashMap<String, String>();
				}
				setResult(false, "No placemark found", collectedData); //$NON-NLS-1$
				getLogger().info("No placemark found " + collectedData.toString()); //$NON-NLS-1$
			}
		}

		setJsonResponse(response, collectedData);

	}

	private String getPlacemarkId(Map<String, String> collectedData) {
		return collectedData.get(PlacemarkInfoServlet.PLACEMARK_ID_PARAMETER);
	}

	private String replacePlacemarkIdTestValue(String placemarkId) {
		if (placemarkId.equals("$[id]")) { //$NON-NLS-1$
			placemarkId = "testPlacemark"; //$NON-NLS-1$
		}
		return placemarkId;
	}
	
}

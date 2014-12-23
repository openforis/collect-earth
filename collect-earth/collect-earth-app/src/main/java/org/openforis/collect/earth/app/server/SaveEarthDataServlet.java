package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.Map;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * Servlet called for updating/saving the information about a placemark. Called from the form in Google Earth when the user interacts with it or clicks the save button.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Controller
public class SaveEarthDataServlet extends JsonPocessorServlet {

	@Autowired
	LocalPropertiesService localPropertiesService;
	
	
	@RequestMapping("/saveData")
	protected void processRequest(HttpServletRequest request, HttpServletResponse response) throws IOException {

		final Map<String, String> collectedData = extractRequestData(request);

		replaceTestVariables(collectedData);

		if (collectedData.size() == 0) {
			setResult(false, Messages.getString("SaveEarthDataServlet.0"), collectedData); //$NON-NLS-1$
			getLogger().info("The request was empty"); //$NON-NLS-1$
		} else {
			if (getDataAccessor().saveData(collectedData)) {
				setResult(true, Messages.getString("SaveEarthDataServlet.2"), collectedData); //$NON-NLS-1$
				getLogger().info("The data was saved for " + collectedData.toString()); //$NON-NLS-1$

			} else {
				setResult(false, Messages.getString("SaveEarthDataServlet.1"), collectedData); //$NON-NLS-1$
				getLogger().error("The data could not be saved for " + collectedData.toString()); //$NON-NLS-1$
			}
		}

		setJsonResponse(response, collectedData);
	}

	/**
	 * This method replaces the variable values that the form contains when it is not run
	 * through Google Earth and the variable replacement of the ExtendedData of the KML does not kick in.
	 * 
	 * @param collectedData
	 *            The data POSTed by the form that has already been processed.
	 */
	private void replaceTestVariables(Map<String, String> collectedData) {
		// REMOVE THIS!!!!
		if (collectedData.get("collect_text_id").equals("$[id]")) { //$NON-NLS-1$ //$NON-NLS-2$
			collectedData.put("collect_text_id", "testPlacemark"); //$NON-NLS-1$ //$NON-NLS-2$
		}

		if (collectedData.get("collect_integer_elevation") != null && collectedData.get("collect_integer_elevation").equals("$[elevation]")) { //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			collectedData.put("collect_integer_elevation", "0"); //$NON-NLS-1$ //$NON-NLS-2$
		}

		if (collectedData.get("collect_real_slope") != null && collectedData.get("collect_real_slope").equals("$[slope]")) { //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			collectedData.put("collect_real_slope", "0"); //$NON-NLS-1$ //$NON-NLS-2$
		}

		if (collectedData.get("collect_real_aspect") != null && collectedData.get("collect_real_aspect").equals("$[aspect]")) { //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			collectedData.put("collect_real_aspect", "0"); //$NON-NLS-1$ //$NON-NLS-2$
		}

		if (collectedData.get("collect_coord_location").equals("$[latitude],$[longitude]")) { //$NON-NLS-1$ //$NON-NLS-2$
			collectedData.put("collect_coord_location", "0,0"); //$NON-NLS-1$ //$NON-NLS-2$
		}
	}

}
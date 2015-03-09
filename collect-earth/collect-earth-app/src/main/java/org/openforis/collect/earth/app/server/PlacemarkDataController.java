package org.openforis.collect.earth.app.server;

import static org.openforis.collect.earth.app.EarthConstants.PLACEMARK_ID_PARAMETER;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;
import java.util.Map.Entry;

import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
import org.springframework.context.annotation.Scope;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.context.WebApplicationContext;

/**
 * Controller to load and store the information that is stored in Collect Earth for one placemark (plot)
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * @author S. Ricci
 * 
 */
@Controller
@Scope(WebApplicationContext.SCOPE_SESSION)
public class PlacemarkDataController extends JsonPocessorServlet {

	@RequestMapping(value="/placemark-info-expanded", method = RequestMethod.GET)
	protected void placemarkInfoExpanded(@RequestParam("id") String placemarkId, HttpServletResponse response) throws IOException {
		PlacemarkLoadResult result;
		if (placemarkId == null) {
			result = new PlacemarkLoadResult();
			result.setSuccess(false);
			String errorMessage = "No placemark ID found in the received request";
			result.setMessage(errorMessage);
			getLogger().error(errorMessage); //$NON-NLS-1$
		} else {
			placemarkId = replacePlacemarkIdTestValue(placemarkId);
			result = getDataAccessor().loadDataExpanded(placemarkId);
			if (result.isSuccess()) {
				result.setMessage("The placemark was found");
			} else {
				getLogger().info("No placemark found with id: " + placemarkId);
			}
		}
		setJsonResponse(response, result);
	}
	
	@RequestMapping(value="/save-data-expanded", method = RequestMethod.POST)
	public void saveDataExpanded(PlacemarkUpdateRequest updateRequest, HttpServletResponse response) throws IOException {
		Map<String, String> collectedData = adjustParameters(updateRequest);

		PlacemarkLoadResult result;
		if (collectedData.isEmpty()) {
			result = new PlacemarkLoadResult();
			result.setSuccess(false);
			result.setMessage(Messages.getString("SaveEarthDataServlet.0")); //$NON-NLS-1$
			getLogger().info("The request was empty"); //$NON-NLS-1$
		} else {
			String placemarkId = replacePlacemarkIdTestValue(updateRequest.getPlacemarkId());
			result = getDataAccessor().updateData(placemarkId, collectedData, updateRequest.isStore());
			if (result.isSuccess()) {
				result.setMessage(Messages.getString("SaveEarthDataServlet.2"));
			}
		}
		setJsonResponse(response, result);
	}

	private Map<String, String> adjustParameters(
			PlacemarkUpdateRequest updateRequest)
			throws UnsupportedEncodingException {
		Map<String, String> originalCollectedData = updateRequest.getValues();
		Map<String, String> collectedData = new HashMap<String, String>(originalCollectedData.size());
		for (Entry<String, String> entry : originalCollectedData.entrySet()) {
			collectedData.put(URLDecoder.decode(entry.getKey(), "UTF-8"), entry.getValue());
		}
		replaceTestParameters(collectedData);
		return collectedData;
	}
	
	/**
	 * This method replaces the variable values that the form contains when it is not run
	 * through Google Earth and the variable replacement of the ExtendedData of the KML does not kick in.
	 * 
	 * @param parameterByName
	 *            The data POSTed by the form that has already been processed.
	 */
	private void replaceTestParameters(Map<String, String> parameterByName) {
		// REMOVE THIS!!!!
		replaceParameter(parameterByName, PLACEMARK_ID_PARAMETER, "$[id]", "testPlacemark"); //$NON-NLS-1$ //$NON-NLS-2$
		replaceParameter(parameterByName, "collect_integer_elevation", "$[elevation]", "0"); //$NON-NLS-1$ //$NON-NLS-2$
		replaceParameter(parameterByName, "collect_real_slope", "$[slope]", "0"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		replaceParameter(parameterByName, "collect_real_aspect", "$[aspect]", "0"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		replaceParameter(parameterByName, "collect_coord_location", "$[latitude],$[longitude]", "0,0"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
	}
	
	private void replaceParameter(Map<String, String> parameterByName, String name, String searchValue, String replaceValue) {
		String val = parameterByName.get(name);
		if (searchValue.equals(val)) {
			parameterByName.put(name, replaceValue);
		}
	}

	private String replacePlacemarkIdTestValue(String placemarkId) {
		if (placemarkId.equals("$[id]")) { //$NON-NLS-1$
			placemarkId = "testPlacemark"; //$NON-NLS-1$
		}
		return placemarkId;
	}
	
	public static class PlacemarkUpdateRequest {
		
		private String placemarkId;
		private Map<String, String> values;
		private boolean store;

		public String getPlacemarkId() {
			return placemarkId;
		}

		public void setPlacemarkId(String id) {
			this.placemarkId = id;
		}
		
		public Map<String, String> getValues() {
			return values;
		}

		public void setValues(Map<String, String> values) {
			this.values = values;
		}

		public boolean isStore() {
			return store;
		}
		
		public void setStore(boolean store) {
			this.store = store;
		}
	}

}

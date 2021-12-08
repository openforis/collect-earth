package org.openforis.collect.earth.app.server;

import static org.openforis.collect.earth.app.EarthConstants.PLACEMARK_ID_PARAMETER;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.NavigableMap;
import java.util.Set;
import java.util.SortedMap;
import java.util.TreeMap;

import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.handlers.BalloonInputFieldsUtils;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
import org.springframework.beans.factory.annotation.Autowired;
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
public class AbstractPlacemarkDataController extends JsonPocessorServlet {

	private static final String PREVIEW_PLOT_ID = "$[EXTRA_id]";
	private Object lastPlacemarkId;
	private String lastPlacemarkStep;

	@Autowired
	protected AbstractEarthSurveyService earthSurveyService;

	protected void placemarkInfoExpanded(@RequestParam("id") String placemarkId, HttpServletResponse response) throws IOException {
		PlacemarkLoadResult result;
		if (placemarkId == null || placemarkId.equals(PREVIEW_PLOT_ID)) {
			result = handleEmptyPlot();
		} else {
			placemarkId = replacePlacemarkIdTestValue(placemarkId);
			result = getDataAccessor().loadDataExpanded(placemarkId.split(","));
			if (result.isSuccess()) {
				result.setMessage("The placemark was found");
				if (placemarkId.equals(lastPlacemarkId)) {
					result.setCurrentStep(lastPlacemarkStep);
				}
			} else {
				getLogger().info("No placemark found with id: {%s}", placemarkId);
			}
		}
		setJsonResponse(response, result);
	}

	private PlacemarkLoadResult handleEmptyPlot() {
		PlacemarkLoadResult result;
		result = new PlacemarkLoadResult();
		result.setSuccess(false);
		String errorMessage = "No placemark ID found in the received request";
		result.setMessage(errorMessage);
		getLogger().error(errorMessage); //$NON-NLS-1$
		return result;
	}

	@RequestMapping(value="/save-data-expanded", method = RequestMethod.POST)
	public void saveDataExpanded(PlacemarkUpdateRequest updateRequest, HttpServletResponse response) throws IOException {
		Map<String, String> collectedData = adjustParameters(updateRequest);

		PlacemarkLoadResult result;
		if (collectedData.isEmpty()) {
			result = handleEmptyCollectedData();
		} else {
			String placemarkId = replacePlacemarkIdTestValue(updateRequest.getPlacemarkId());

			result = processCollectedData(updateRequest, collectedData,	placemarkId);
		}
		setJsonResponse(response, result);
	}

	public PlacemarkLoadResult processCollectedData(
			PlacemarkUpdateRequest updateRequest,
			Map<String, String> collectedData, String placemarkKey ) {
		PlacemarkLoadResult result = getDataAccessor().updateData( placemarkKey.split(",") , collectedData,
				updateRequest.isPartialUpdate());

		if (result.isSuccess()) {
			result.setMessage(Messages.getString("SaveEarthDataServlet.2")); //$NON-NLS-1$
			lastPlacemarkId = placemarkKey;
			lastPlacemarkStep = updateRequest.getCurrentStep();
		}else{
			logger.warn("Error when saving the data %s", result );
		}
		return result;
	}

	public PlacemarkLoadResult handleEmptyCollectedData() {
		PlacemarkLoadResult result;
		result = new PlacemarkLoadResult();
		result.setSuccess(false);
		result.setMessage(Messages.getString("SaveEarthDataServlet.0")); //$NON-NLS-1$
		getLogger().info("The request was empty"); //$NON-NLS-1$
		return result;
	}


	private Map<String, String> adjustParameters( PlacemarkUpdateRequest updateRequest )
			throws UnsupportedEncodingException {
		Map<String, String> originalCollectedData = updateRequest.getValues();
		Map<String, String> result = new HashMap<String, String>(originalCollectedData.size());
		for (Entry<String, String> entry : originalCollectedData.entrySet()) {
			if( entry.getKey().equals( EarthConstants.PLACEMARK_ID_PARAMETER ) ){
				// If there are multiple keys this value will be the combination of the keys, with the first value actually containing the plot id
				entry.setValue( entry.getValue().split(",")[0]);
			}

			//decode parameter name, it was previously encoded by the client
			result.put(URLDecoder.decode(entry.getKey(), StandardCharsets.UTF_8.name()), entry.getValue());

		}
		replaceTestParameters(result);
		return sortParameters(result);
	}

	/**
	 * Sort parameters based on schema order (BFS)
	 * @param parameters Parameters to be sorted
	 * @return The parameters sorted alphabetically
	 */
	public Map<String, String> sortParameters(Map<String, String> parameters) {
		NavigableMap<String, String> navigableParameters = new TreeMap<String, String>(parameters);
		//extract parameter names in order
		BalloonInputFieldsUtils collectParametersHandler = new BalloonInputFieldsUtils();
		Map<String, String> sortedParameterNameByNodePath = collectParametersHandler.getHtmlParameterNameByNodePath(earthSurveyService.getRootEntityDefinition());
		List<String> sortedParameterNames = new ArrayList<String>(sortedParameterNameByNodePath.values());

		//create a new map and put the parameters in order there
		Map<String, String> result = new LinkedHashMap<String, String>(navigableParameters.size());
		for (String parameterName : sortedParameterNames) {
			//get all the entries with key starting with parameterName
			SortedMap<String,String> subMap = new TreeMap<String, String>( navigableParameters.subMap(parameterName, parameterName + Character.MAX_VALUE) );
			Set<Entry<String,String>> entrySet = subMap.entrySet();
			for (Entry<String, String> entry : entrySet) {
					result.put(entry.getKey(), entry.getValue());
					navigableParameters.remove(entry.getKey());
			}
		}
		//add remaining parameters (if any)
		result.putAll(navigableParameters);
		return result;
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
		if (placemarkId.equals("$[id]")) //$NON-NLS-1$
			return "testPlacemark"; //$NON-NLS-1$
		else
			return placemarkId;
	}
}

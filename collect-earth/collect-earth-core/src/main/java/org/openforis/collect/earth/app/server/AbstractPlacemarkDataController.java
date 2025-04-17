package org.openforis.collect.earth.app.server;

import static org.openforis.collect.earth.app.EarthConstants.PLACEMARK_ID_PARAMETER;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.TreeMap;

import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.handlers.BalloonInputFieldsUtils;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
import org.openforis.idm.metamodel.EntityDefinition;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
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

	@PostMapping(value="/save-data-expanded")
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
	

	@PostMapping(value="/create-entity")
	public void createEntity(PlacemarkEntityCreateParams params, HttpServletResponse response) throws IOException {
		Map<String, String> adjustedParams = adjustParameters(params);
		String placemarkId = replacePlacemarkIdTestValue(params.getPlacemarkId());
		String[] keyValues = placemarkId.split(",");
		PlacemarkLoadResult result = getDataAccessor().addNewEntity(keyValues, params.getEntityName(), adjustedParams);
		afterPlacemarkUpdate(placemarkId, lastPlacemarkStep, result);
		setJsonResponse(response, result);
	}
	
	@PostMapping(value="/delete-entity")
	public void deleteEntity(PlacemarkEntityCreateParams params, HttpServletResponse response) throws IOException {
		Map<String, String> adjustedParams = adjustParameters(params);
		String placemarkId = replacePlacemarkIdTestValue(params.getPlacemarkId());
		String[] keyValues = placemarkId.split(",");
		PlacemarkLoadResult result = getDataAccessor().deleteEntity(keyValues, params.getEntityName(), adjustedParams);
		afterPlacemarkUpdate(placemarkId, lastPlacemarkStep, result);
		setJsonResponse(response, result);
	}


	public PlacemarkLoadResult processCollectedData(
			PlacemarkUpdateRequest updateRequest,
			Map<String, String> collectedData, String placemarkKey ) {
		
		PlacemarkLoadResult result = getDataAccessor().updateData( 
								placemarkKey.split(","), 
								collectedData,
								updateRequest.isPartialUpdate()
						);
		afterPlacemarkUpdate(placemarkKey, lastPlacemarkStep, result);
		return result;
	}

	private void afterPlacemarkUpdate(String placemarkKey, String currentStep, PlacemarkLoadResult result) {
		if (result.isSuccess()) {
			result.setMessage(Messages.getString("SaveEarthDataServlet.2")); //$NON-NLS-1$
			lastPlacemarkId = placemarkKey;
			lastPlacemarkStep = currentStep;
		}else{
			logger.warn("Error when saving the data %s", result );
		}
	}

	public PlacemarkLoadResult handleEmptyCollectedData() {
		PlacemarkLoadResult result = new PlacemarkLoadResult();
		result.setSuccess(false);
		result.setMessage(Messages.getString("SaveEarthDataServlet.0")); //$NON-NLS-1$
		getLogger().info("The request was empty"); //$NON-NLS-1$
		return result;
	}


	private Map<String, String> adjustParameters( PlacemarkUpdateRequest updateRequest )
			throws UnsupportedEncodingException {
		Map<String, String> originalCollectedData = updateRequest.getValues();
		if (originalCollectedData == null) {
			return Collections.emptyMap();
		}
		Map<String, String> result = new HashMap<String, String>(originalCollectedData.size());
		for (Entry<String, String> entry : originalCollectedData.entrySet()) {
			String key = entry.getKey();
			String value = entry.getValue();
			if( key.equals( EarthConstants.PLACEMARK_ID_PARAMETER ) ){
				// If there are multiple keys this value will be the combination of the keys, with the first value actually containing the plot id
				entry.setValue( value.split(",")[0]);
			}

			//decode parameter name, it was previously encoded by the client
			result.put(URLDecoder.decode(key, StandardCharsets.UTF_8.name()), value);

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
		//extract parameter names in order
		BalloonInputFieldsUtils collectParametersHandler = new BalloonInputFieldsUtils();
		EntityDefinition rootEntityDef = earthSurveyService.getRootEntityDefinition();
		LinkedHashMap<String, String> sortedParameterNameByNodePath = collectParametersHandler.getHtmlParameterNameByNodePath(rootEntityDef);
		List<String> sortedParameterNames = new ArrayList<>(sortedParameterNameByNodePath.values());

		TreeMap<String, String> sortedParameters = new TreeMap<>(new ParametersKeyComparator(sortedParameterNames));
        sortedParameters.putAll(parameters);
		return sortedParameters;
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
	
	// sort input parameters following the hierarchical order
	// parameters inside multiple entities will be sorted by the entity index, then by the order in the survey designer
    private static class ParametersKeyComparator implements Comparator<String> {
    	private static final String entityIndexRegexReplace = "\\[\\d+\\]";
    	private static final String entityIndexReplacement = "[\\$index]";
    	
		private List<String> sortedParameterNames;
		
		public ParametersKeyComparator(List<String> sortedParameterNames) {
			this.sortedParameterNames = sortedParameterNames;
		}
		
        @Override
        public int compare(String key1, String key2) {
	        String modifiedKey1 = cleanupKey(key1);
	        String modifiedKey2 = cleanupKey(key2);
	        int sortedParametersKey1Index = sortedParameterNames.indexOf(modifiedKey1);
	        int sortedParametersKey2Index = sortedParameterNames.indexOf(modifiedKey2);
		        
            // Check if both keys are related to a multiple entity attribute
            if (key1.contains("[") && key2.contains("[")) {
                // Extract the index from the keys
                int entityIndex1 = extractEntityIndex(key1);
                int entityIndex2 = extractEntityIndex(key2);
                // Compare the indices
                int indexCompare = Integer.compare(entityIndex1, entityIndex2);
                if (indexCompare != 0) {
                	return indexCompare;
                }
            }
            if (sortedParametersKey1Index != -1 && sortedParametersKey2Index != -1) {
            	return Integer.compare(sortedParametersKey1Index, sortedParametersKey2Index);
            }
            // For other keys, maintain their original order (if using LinkedHashMap initially)
            return key1.compareTo(key2);
        }

		private String cleanupKey(String key) {
			return key.replaceAll(entityIndexRegexReplace, entityIndexReplacement);
		}
        
        private int extractEntityIndex(String key) {
            int startIndex = key.indexOf("[");
            int endIndex = key.indexOf("]");
            if (startIndex != -1 && endIndex != -1 && startIndex < endIndex) {
                try {
                    return Integer.parseInt(key.substring(startIndex + 1, endIndex));
                } catch (NumberFormatException e) {
                    // Index could be a code list value (enumerated entity)
                    return Integer.MAX_VALUE;
                }
            }
            return Integer.MAX_VALUE; // Should not happen for keys we are comparing
        }
    };
}

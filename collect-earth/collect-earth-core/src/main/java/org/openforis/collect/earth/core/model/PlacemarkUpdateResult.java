package org.openforis.collect.earth.core.model;

import java.util.HashMap;
import java.util.Map;

/**
 * 
 * @author S. Ricci
 *
 */
public class PlacemarkUpdateResult {

	private Map<String, PlacemarkInputFieldInfo> inputFieldInfoByParameterName;
	private boolean success;
	private String errorMessage;
	
	public PlacemarkUpdateResult() {
		this.success = false;
		this.inputFieldInfoByParameterName = new HashMap<String, PlacemarkInputFieldInfo>();
	}
	
	public void setFieldErrorMessage(String parameterName, String errorMessage) {
		PlacemarkInputFieldInfo placemarkInfo = getPlacemarkInfo(parameterName);
		placemarkInfo.setErrorMessage(errorMessage);
	}

	public PlacemarkInputFieldInfo getPlacemarkInfo(String parameterName) {
		PlacemarkInputFieldInfo placemarkInputFieldInfo = inputFieldInfoByParameterName.get(parameterName);
		if (placemarkInputFieldInfo == null) {
			placemarkInputFieldInfo = new PlacemarkInputFieldInfo();
		}
		return placemarkInputFieldInfo;
	}
	
	public boolean isSuccess() {
		return success;
	}
	
	public void setSuccess(boolean success) {
		this.success = success;
	}
	
	public String getErrorMessage() {
		return errorMessage;
	}

	public void setErrorMessage(String errorMessage) {
		this.errorMessage = errorMessage;
	}

	public Map<String, PlacemarkInputFieldInfo> getInputFieldInfoByParameterName() {
		return inputFieldInfoByParameterName;
	}
	
	public void setInputFieldInfoByParameterName(
			Map<String, PlacemarkInputFieldInfo> inputFieldInfoByParameterName) {
		this.inputFieldInfoByParameterName = inputFieldInfoByParameterName;
	}
	
	
	
}

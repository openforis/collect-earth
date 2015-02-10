package org.openforis.collect.earth.app.server;

import java.util.HashMap;
import java.util.Map;

public class PlacemarkSaveResult {

	private Map<String, PlacemarkInputFieldInfo> inputFieldInfoByParameterName;
	private boolean success;
	
	public PlacemarkSaveResult() {
		this.success = false;
		this.inputFieldInfoByParameterName = new HashMap<String, PlacemarkInputFieldInfo>();
	}
	
	public boolean isSuccess() {
		return success;
	}
	
	public void setSuccess(boolean success) {
		this.success = success;
	}
	
	public Map<String, PlacemarkInputFieldInfo> getInputFieldInfoByParameterName() {
		return inputFieldInfoByParameterName;
	}
	
	public void setFieldValidationMessage(String parameterName, String validationMessage) {
//		PlacemarkInputFieldInfo placemarkInputFieldInfo = inputFieldInfoByParameterName.get(parameterName);
	}
	
}

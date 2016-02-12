package org.openforis.collect.earth.core.model;

import java.util.HashMap;
import java.util.Map;
import java.util.Map.Entry;

import org.openforis.collect.model.CollectRecord;

/**
 * 
 * @author S. Ricci
 *
 */
public class PlacemarkLoadResult {

	private Map<String, PlacemarkInputFieldInfo> inputFieldInfoByParameterName;
	private boolean success;
	private String message;
	private boolean activelySaved;
	private boolean validData;
	private boolean skipFilled;
	private String currentStep;
	
	private transient CollectRecord collectRecord;
	
	public PlacemarkLoadResult() {
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
	
	private void updateCalculatedFields() {
		PlacemarkInputFieldInfo activelySavedFieldInfo = inputFieldInfoByParameterName.get("collect_boolean_actively_saved");
		activelySaved = activelySavedFieldInfo != null && Boolean.TRUE.toString().equals(activelySavedFieldInfo.getValue());
		validData = calculateContainsValidData();
	}

	private boolean calculateContainsValidData() {
		for (Entry<String, PlacemarkInputFieldInfo> entry : inputFieldInfoByParameterName.entrySet()) {
			PlacemarkInputFieldInfo info = entry.getValue();
			if (info.isInError()) {
				return false;
			}
		}
		return true;
	}
	
	public boolean isValidData() {
		return validData;
	}
	
	/**
	 * Calculated field based on inputFieldInfoByParameterName content
	 */
	public boolean isActivelySaved() {
		return activelySaved;
	}
	
	public boolean isSuccess() {
		return success;
	}
	
	public void setSuccess(boolean success) {
		this.success = success;
	}
	
	public String getMessage() {
		return message;
	}
	
	public void setMessage(String message) {
		this.message = message;
	}
	
	public Map<String, PlacemarkInputFieldInfo> getInputFieldInfoByParameterName() {
		return inputFieldInfoByParameterName;
	}
	
	public void setInputFieldInfoByParameterName(
			Map<String, PlacemarkInputFieldInfo> inputFieldInfoByParameterName) {
		this.inputFieldInfoByParameterName = inputFieldInfoByParameterName;
		updateCalculatedFields();
	}
	
	public CollectRecord getCollectRecord() {
		return collectRecord;
	}
	
	public void setCollectRecord(CollectRecord collectRecord) {
		this.collectRecord = collectRecord;
	}

	public boolean isSkipFilled() {
		return skipFilled;
	}
	
	public void setSkipFilled(boolean skipFilled) {
		this.skipFilled = skipFilled;
	}
	
	public String getCurrentStep() {
		return currentStep;
	}
	
	public void setCurrentStep(String currentStep) {
		this.currentStep = currentStep;
	}

	@Override
	public String toString() {
		return "PlacemarkLoadResult [inputFieldInfoByParameterName="
				+ inputFieldInfoByParameterName + ", success=" + success
				+ ", message=" + message + ", activelySaved=" + activelySaved
				+ ", currentStep=" + currentStep + "]";
	}
	
}

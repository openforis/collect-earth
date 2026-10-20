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
	private String deletedEntityDefName;
	
	private transient CollectRecord collectRecord;
	
	public PlacemarkLoadResult() {
		this.success = false;
		this.inputFieldInfoByParameterName = new HashMap<String, PlacemarkInputFieldInfo>();
	}
	
	public void setFieldErrorMessage(String parameterName, String errorMessage) {
		PlacemarkInputFieldInfo placemarkInfo = getPlacemarkInfo(parameterName);
		placemarkInfo.setErrorMessage(errorMessage);
	}

	/**
	 * Reports on its field a value that the interpreter typed and that could not be read. The balloon shows the message under
	 * the field, and does not let the plot be submitted while it is there.
	 */
	public void setInvalidValue(String parameterName, String errorMessage) {
		// A partial update only returns the fields that changed, and this one did not : an info created here would be read by
		// the balloon as a field that is not relevant, and hidden. The interpreter has just typed into it, so it is relevant
		boolean newInfo = !inputFieldInfoByParameterName.containsKey(parameterName);
		PlacemarkInputFieldInfo placemarkInfo = getPlacemarkInfo(parameterName);
		if (newInfo) {
			placemarkInfo.setVisible(true);
		}
		placemarkInfo.setInError(true);
		placemarkInfo.setErrorMessage(errorMessage);
		updateCalculatedFields();
	}

	public PlacemarkInputFieldInfo getPlacemarkInfo(String parameterName) {
		// Keep the new info in the map : it used to be returned detached, so setFieldErrorMessage wrote into an object nobody read
		return inputFieldInfoByParameterName.computeIfAbsent(parameterName, name -> new PlacemarkInputFieldInfo());
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
	 * @return True if the user clicked on the Submit button
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
	
	public String getDeletedEntityDefName() {
		return deletedEntityDefName;
	}
	
	public void setDeletedEntityDefName(String deletedEntityDefName) {
		this.deletedEntityDefName = deletedEntityDefName;
	}
	
	@Override
	public String toString() {
		return "PlacemarkLoadResult [inputFieldInfoByParameterName="
				+ inputFieldInfoByParameterName + ", success=" + success
				+ ", message=" + message + ", activelySaved=" + activelySaved
				+ ", currentStep=" + currentStep + "]";
	}
	
}

package org.openforis.collect.earth.app.server;

import java.util.Map;

public class PlacemarkUpdateRequest {
	
	private Map<String, String> values;
	private String currentStep;
	private String placemarkId;
	private boolean partialUpdate = false;
	
	public Map<String, String> getValues() {
		return values;
	}
	
	public void setValues(Map<String, String> values) {
		this.values = values;
	}

	public String getCurrentStep() {
		return currentStep;
	}
	
	public void setCurrentStep(String currentStep) {
		this.currentStep = currentStep;
	}
	
	public String getPlacemarkId() {
		return placemarkId;
	}

	public void setPlacemarkId(String placemarkId) {
		this.placemarkId = placemarkId;
	}
	
	public boolean isPartialUpdate() {
		return partialUpdate;
	}
	
	public void setPartialUpdate(boolean partialUpdate) {
		this.partialUpdate = partialUpdate;
	}
}
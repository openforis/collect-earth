package org.openforis.collect.earth.core.model;

import java.util.List;

/**
 * 
 * @author S. Ricci
 *
 */
public class PlacemarkInputFieldInfo {
	
	private boolean visible;
	private boolean inError;
	private String errorMessage;
	private List<PlacemarkCodedItem> possibleCodedItems;

	public boolean isVisible() {
		return visible;
	}
	
	public void setVisible(boolean visible) {
		this.visible = visible;
	}
	
	public boolean isInError() {
		return inError;
	}

	public void setInError(boolean inError) {
		this.inError = inError;
	}

	public String getErrorMessage() {
		return errorMessage;
	}

	public void setErrorMessage(String errorMessage) {
		this.errorMessage = errorMessage;
	}

	public List<PlacemarkCodedItem> getPossibleCodedItems() {
		return possibleCodedItems;
	}

	public void setPossibleCodedItems(List<PlacemarkCodedItem> possibleCodedItems) {
		this.possibleCodedItems = possibleCodedItems;
	}

}
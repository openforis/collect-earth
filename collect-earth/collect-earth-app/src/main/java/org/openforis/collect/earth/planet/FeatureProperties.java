package org.openforis.collect.earth.planet;

import java.util.Date;

public class FeatureProperties {

	Date acquired;
	Integer clear_percent;
	Float cloud_cover;
	String item_type;
	String instrument;

	public Date getAcquired() {
		return acquired;
	}

	public void setAcquired(Date acquired) {
		this.acquired = acquired;
	}

	public Integer getClearPercent() {
		return clear_percent;
	}

	public float getCloudCover() {
		return cloud_cover;
	}

	public String getItemType() {
		return item_type;
	}

	public void setItemType(String item_type) {
		this.item_type = item_type;
	}

	public String getInstrument() {
		return instrument;
	}

	public void setInstrument(String instrument) {
		this.instrument = instrument;
	}
	
	
}

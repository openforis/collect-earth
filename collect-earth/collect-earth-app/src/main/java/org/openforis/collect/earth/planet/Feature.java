package org.openforis.collect.earth.planet;

public class Feature {

	FeatureProperties properties;
	String id;

	public FeatureProperties getProperties() {
		return properties;
	}

	public void setProperties(FeatureProperties properties) {
		this.properties = properties;
	}

	public String getId() {
		return id;
	}

	public void setId(String id) {
		this.id = id;
	}
	
	@Override
	public String toString() {
		return id + 
					" - cloud percent " + (properties.getCloudPercent()!=null?properties.getCloudPercent():"NULL") + 
					" - visible confidence percent " + (properties.getVisibleConfidencePercent()!=null?properties.getVisibleConfidencePercent():"NULL") + 
					" - cloud cover " + (properties.getCloudCover()!=null?properties.getCloudCover():"NULL") + 
					" - item type " + properties.getItemType() + "\n";
	}
}

package org.openforis.collect.earth.ipcc.model;

public enum ManagementTypeEnum {

	MANAGED("Managed"),UNMANAGED("Unmanaged");
	
	public final String name;
	
	private ManagementTypeEnum(String name) {
        this.name = name;
    }

	public String getName() {
		return name;
	}

	@Override
	public String toString() {
		return getName();
	}
}

package org.openforis.collect.earth.ipcc.model;

public class SettlementSubdivision extends LandUseSubdivision<SettlementType>{
	
	protected SettlementType type;
	
	public SettlementSubdivision( String code, String name, SettlementType type, Integer id) {
		super(LandUseCategory.S, code, name, id);
		setManagementType(type);
	}

	public SettlementType getManagementType() {
		return type;
	}

	public void setManagementType(SettlementType type) {
		this.type = type;
	};
	
}

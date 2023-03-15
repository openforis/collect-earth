package org.openforis.collect.earth.ipcc.model;

public class SettlementSubdivision extends AbstractLandUseSubdivision<SettlementTypeEnum>{
	
	protected SettlementTypeEnum type;
	
	public SettlementSubdivision( String code, String name, SettlementTypeEnum type, Integer id) {
		super(LandUseCategoryEnum.S, code, name, id);
		setManagementType(type);
	}

	public SettlementTypeEnum getManagementType() {
		return type;
	}

	public void setManagementType(SettlementTypeEnum type) {
		this.type = type;
	};
	
}

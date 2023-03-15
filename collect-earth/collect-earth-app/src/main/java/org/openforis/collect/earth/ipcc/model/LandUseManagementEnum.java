package org.openforis.collect.earth.ipcc.model;

import java.util.ArrayList;
import java.util.Collection;

public enum LandUseManagementEnum {
	MFL ("MFL", "Managed Forest Land", 1, LandUseCategoryEnum.F, ManagementTypeEnum.MANAGED), 
	UFL ("UFL", "Unmanaged Forest Land", 2, LandUseCategoryEnum.F, ManagementTypeEnum.UNMANAGED),
	ACL ("ACL", "Cropland Annual Crops", 3, LandUseCategoryEnum.C, CroplandTypeEnum.ANNUAL ),
	PCL ("PCL", "Cropland Perennial Crops", 4, LandUseCategoryEnum.C, CroplandTypeEnum.PERENNIAL),
	MGL ("MGL", "Managed Grassland", 5, LandUseCategoryEnum.G, ManagementTypeEnum.MANAGED),
	UGL ("UGL", "Unmanaged Grassland", 6, LandUseCategoryEnum.G, ManagementTypeEnum.UNMANAGED),
	MWL ("MWL", "Managed Wetlands", 7, LandUseCategoryEnum.W, ManagementTypeEnum.MANAGED),
	UWL ("UWL", "Unmanaged Wetlands", 8, LandUseCategoryEnum.W, ManagementTypeEnum.UNMANAGED),
	TSL ("TSL", "Settlements (Treed)", 9, LandUseCategoryEnum.S, SettlementTypeEnum.TREED),
	OSL ("OSL", "Settlements (Other)", 10, LandUseCategoryEnum.S, SettlementTypeEnum.OTHER),
	MOL ("MOL", "Managed Other Land", 11, LandUseCategoryEnum.O, ManagementTypeEnum.MANAGED),
	UOL ("UOL", "Unmanaged Other Land", 12, LandUseCategoryEnum.O, ManagementTypeEnum.UNMANAGED),
	;
	
	private final String code;
	private final String name;
	private final Integer id;
	private final Object managementType;
	private LandUseCategoryEnum luCategory;

    private LandUseManagementEnum(String code, String name, Integer id, LandUseCategoryEnum luCategory, Object managementType ) {
        this.code = code;
        this.name = name;
        this.id = id;
        this.luCategory = luCategory;
        this.managementType = managementType;
    }

    @Override
    public String toString() {
    	return getCode();
    }

    public String getCode() {
		return code;
	}

	public String getName() {
		return name;
	}

	public Integer getId() {
		return id;
	}

	public Object getManagementType() {
		return managementType;
	}
	
	public static Collection<LandUseManagementEnum> find( LandUseCategoryEnum category) {
		Collection<LandUseManagementEnum> landUsesForCategory = new ArrayList<LandUseManagementEnum>();
		for (LandUseManagementEnum lum : LandUseManagementEnum.values()) {
			if( lum.getLuCategory().equals( category )  ) {
				landUsesForCategory.add(lum);
			}
		}
		return landUsesForCategory;
	}
	
	public static LandUseManagementEnum find( LandUseCategoryEnum category, Object management) {
		for (LandUseManagementEnum lum : LandUseManagementEnum.values()) {
			if( lum.getLuCategory().equals( category ) && lum.getManagementType().equals( management ) ) {
				return lum;
			}
		}
		throw new IllegalArgumentException("The combination " + category + "/" + management + " could not be found" );
	}

	public LandUseCategoryEnum getLuCategory() {
		return luCategory;
	}

	public void setLuCategory(LandUseCategoryEnum luCategory) {
		this.luCategory = luCategory;
	}

}
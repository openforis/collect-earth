package org.openforis.collect.earth.ipcc.model;

import java.util.ArrayList;
import java.util.Collection;

public enum LandUseManagement {
	MFL ("MFL", "Managed Forest Land", 1, LandUseCategory.F, ManagementType.MANAGED), 
	UFL ("UFL", "Unmanaged Forest Land", 1, LandUseCategory.F, ManagementType.UNMANAGED),
	ACL ("ACL", "Cropland Annual Crops", 1, LandUseCategory.C, CroplandType.ANNUAL ),
	PCL ("PCL", "Cropland Perennial Crops", 1, LandUseCategory.C, CroplandType.PERENNIAL),
	MGL ("MGL", "Managed Grassland", 1, LandUseCategory.G, ManagementType.MANAGED),
	UGL ("UGL", "Unmanaged Grassland", 1, LandUseCategory.G, ManagementType.UNMANAGED),
	MWL ("MWL", "Managed Wetlands", 1, LandUseCategory.W, ManagementType.MANAGED),
	UWL ("UWL", "Unmanaged Wetlands", 1, LandUseCategory.W, ManagementType.UNMANAGED),
	TSL ("TSL", "Settlements (Treed)", 1, LandUseCategory.S, SettlementType.TREED),
	OSL ("OSL", "Settlements (Other)", 1, LandUseCategory.S, SettlementType.OTHER),
	MOL ("MOL", "Managed Other Land", 1, LandUseCategory.O, ManagementType.MANAGED),
	UOL ("UOL", "Unmanaged Other Land", 1, LandUseCategory.O, ManagementType.UNMANAGED),
	;
	
	private final String code;
	private final String name;
	private final Integer id;
	private final Object managementType;
	private LandUseCategory luCategory;

    private LandUseManagement(String code, String name, Integer id, LandUseCategory luCategory, Object managementType ) {
        this.code = code;
        this.name = name;
        this.id = id;
        this.luCategory = luCategory;
        this.managementType = managementType;
    }

	public String getCode() {
		return code;
	}

	public String getName() {
		return name;
	}

	@Override
	public String toString() {
		return getCode();
	}

	public Integer getId() {
		return id;
	}

	public Object getManagementType() {
		return managementType;
	}
	
	public static Collection<LandUseManagement> find( LandUseCategory category) {
		Collection<LandUseManagement> landUsesForCategory = new ArrayList<LandUseManagement>();
		for (LandUseManagement lum : LandUseManagement.values()) {
			if( lum.getLuCategory().equals( category )  ) {
				landUsesForCategory.add(lum);
			}
		}
		return landUsesForCategory;
	}
	
	public static LandUseManagement find( LandUseCategory category, Object management) {
		for (LandUseManagement lum : LandUseManagement.values()) {
			if( lum.getLuCategory().equals( category ) && lum.getManagementType().equals( management ) ) {
				return lum;
			}
		}
		throw new IllegalArgumentException("The combination " + category + "/" + management + " could not be found" );
	}

	public LandUseCategory getLuCategory() {
		return luCategory;
	}

	public void setLuCategory(LandUseCategory luCategory) {
		this.luCategory = luCategory;
	}

}

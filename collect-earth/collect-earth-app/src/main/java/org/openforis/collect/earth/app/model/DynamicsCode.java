package org.openforis.collect.earth.app.model;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.view.Messages;

/**
 * Enumeration of the dynamics that Collect Earth can use to classify the plots.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
public enum DynamicsCode {
	FROM_FOREST(Messages.getString("DynamicsCode.0"), 1), FROM_GRASSLAND(Messages.getString("DynamicsCode.1"), 3), FROM_SETTLEMENT(Messages.getString("DynamicsCode.2"), 4), FROM_OTHERLAND(Messages.getString("DynamicsCode.3"), 5), FROM_WETLAND(Messages.getString("DynamicsCode.4"), 6), FROM_CROPLAND(Messages.getString("DynamicsCode.5"), 7),  NA("NA", 8); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$ //$NON-NLS-6$

	private String label;

	private int id;

	private DynamicsCode(String label, int id) {
		this.label = label;
		this.id = id;
	}

	public int getId() {
		return id;
	}

	public String getLabel() {
		return label;
	}

	public void setId(int id) {
		this.id = id;
	}

	@Override
	public String toString() {
		return label;
	}

	public static Integer getDynamicsCode(String landUseSubcategory) {
		if( landUseSubcategory.startsWith("FLto") ){ //$NON-NLS-1$
			return FROM_FOREST.getId();
		}else if( landUseSubcategory.startsWith("CLto") ){ //$NON-NLS-1$
			return FROM_CROPLAND.getId();
		}else if( landUseSubcategory.startsWith("SLto") ){ //$NON-NLS-1$
			return FROM_SETTLEMENT.getId();
		}else if( landUseSubcategory.startsWith("WLto") ){ //$NON-NLS-1$
			return FROM_WETLAND.getId();
		}else if( landUseSubcategory.startsWith("GLto") ){ //$NON-NLS-1$
			return FROM_GRASSLAND.getId();
		}else if( landUseSubcategory.startsWith("OLto") || landUseSubcategory.startsWith("OTto")){ //$NON-NLS-1$ //$NON-NLS-2$
			return FROM_OTHERLAND.getId();
		}else if ( StringUtils.isBlank( landUseSubcategory )) {
			throw new IllegalArgumentException("The land use subcategory " + landUseSubcategory + " is not recognizable."); //$NON-NLS-1$ //$NON-NLS-2$
		}else{
			return NA.getId();
		}
	}

}

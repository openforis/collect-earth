package org.openforis.collect.earth.ipcc.model;

public enum ForestTypeEnum {
			PINUS( "Pinus" ,1 ),
			LARCH( "Larch", 2),
			FIRS( "Firs and spruce", 3 ),
			OTHER_CONIF( "Other Coniferous", 4 ),
			EUCALYPTUS( "Eucalyptus", 5 ),
			TECTONA("Tectona grandis",6 ),
			OTHER_BROADLEAF( "Other Broadleaf", 7 ),
			QUERCUS( "Quercus",8 ),
			USER( "User-defined", 9 ),
			MANGROVES ( "Mangroves", 10 );
			
			public final String name;
			public final Integer id;
			
			private ForestTypeEnum(String name, Integer id) {
		        this.name = name;
		        this.id = id;
		    }

			public String getName() {
				return name;
			}
			
			public Integer getId() {
				return id;
			}

			@Override
			public String toString() {
				return getName();
			}

}

package org.openforis.collect.earth.ipcc;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;

public class MatrixSheet {

	private YearData yearData;

	public MatrixSheet(YearData yearData) {
		this.yearData = yearData;
	}

	public List<AbstractLandUseSubdivision<?>> getSubdivisions() {
		List<AbstractLandUseSubdivision<?>> subdivisions = new ArrayList<>();

		for (LUSubdivisionDataPerYear<?, ?> luDataYear : yearData.getLuData()) {

			if( luDataYear.getLu() != null && subdivisions.indexOf( luDataYear.getLu() ) == -1 ) {
				subdivisions.add( luDataYear.getLu());
			}

			if( luDataYear.getLuNextYear() != null && subdivisions.indexOf( luDataYear.getLuNextYear() ) == -1 ) {
				subdivisions.add( luDataYear.getLuNextYear());
			}
		}
		
		Collections.sort( subdivisions );

		return subdivisions;
		
	}
	

	public YearData getYearData() {
		return yearData;
	}

}

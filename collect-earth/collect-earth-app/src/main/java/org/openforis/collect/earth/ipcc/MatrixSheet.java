package org.openforis.collect.earth.ipcc;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;

public class MatrixSheet {

	private YearData yearData;

	public MatrixSheet(YearData yearData) {
		this.yearData = yearData;
	}

	public List<LandUseSubdivision<?>> getSubdivisions() {
		List<LandUseSubdivision<?>> subdivisions = new ArrayList<>();

		for (LUDataPerYear<?, ?> luDataYear : yearData.getLuData()) {

			if( subdivisions.indexOf( luDataYear.getLu() ) == -1 ) {
				subdivisions.add( luDataYear.getLu());
			}

			if( subdivisions.indexOf( luDataYear.getLuNextYear() ) == -1 ) {
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

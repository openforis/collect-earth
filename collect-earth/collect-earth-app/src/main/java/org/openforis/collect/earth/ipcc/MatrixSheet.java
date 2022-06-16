package org.openforis.collect.earth.ipcc;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MatrixSheet {

	private YearData yearData;

	public MatrixSheet(YearData yearData) {
		this.yearData = yearData;
	}

	public List<LUSubdivision> getSubdivisions() {
		List<LUSubdivision> subdivisions = new ArrayList<>();

		for (LUDataPerYear luDataYear : yearData.getLuData()) {

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

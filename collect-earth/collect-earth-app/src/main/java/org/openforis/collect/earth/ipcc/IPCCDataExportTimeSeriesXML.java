package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import com.thoughtworks.xstream.XStream;

@Component
public class IPCCDataExportTimeSeriesXML extends IPCCDataExportTimeSeries<LUDataPerYear> {

	@Override
	protected RowMapper<LUDataPerYear> getRowMapper() {
		return new RowMapper<LUDataPerYear>() {
			@Override
			public LUDataPerYear mapRow(ResultSet rs, int rowNum) throws SQLException {
				
				String categoryInitial = rs.getString(1);
				String categoryFinal = rs.getString(2);
				String subdivInitial = rs.getString(3);
				String subdivFinal = rs.getString(4);
				
				return new LUDataPerYear(
						LandUseSubdivisionUtils.getSubdivision(categoryInitial, subdivInitial),
						LandUseSubdivisionUtils.getSubdivision(categoryFinal, subdivFinal),
						rs.getDouble(5) // area
						);
			}
		};
	}

	@Override
	protected File generateFile( List<LUDataPerYear> strataData) throws IOException {
		File xmlFileDestination = File.createTempFile("landUsesTimeseries", ".xml");
		xmlFileDestination.deleteOnExit();
		XStream xStream = new XStream();
		xStream.alias("LandUse", LUDataPerYear.class);
		xStream.alias("Stratum", StratumPerYearData.class);
		xStream.alias("Subdivision", LandUseSubdivision.class);
		
		xStream.setMode(XStream.NO_REFERENCES);
		String xmlSchema = xStream.toXML(strataData);
				
		try (FileOutputStream outputStream = new FileOutputStream( xmlFileDestination ) ) {
			byte[] strToBytes = xmlSchema.getBytes();
			outputStream.write(strToBytes);
		} catch (Exception e) {
			logger.error("Error saving data to file", e);
		}
				
		return xmlFileDestination;
	}
}

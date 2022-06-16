package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.FileOutputStream;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import com.thoughtworks.xstream.XStream;

@Component
public class IPCCDataExportTimeSeriesCSV extends IPCCDataExportTimeSeries<LUDataPerYear> {

	@Override
	protected RowMapper<LUDataPerYear> getRowMapper() {
		return new RowMapper<LUDataPerYear>() {
			@Override
			public LUDataPerYear mapRow(ResultSet rs, int rowNum) throws SQLException {
				return new LUDataPerYear(
						new LUSubdivision ( 
								rs.getString(1), // cat year
								rs.getString(3) // subdivision year
						),
						new LUSubdivision(
								rs.getString(2), // cat year+1
								rs.getString(4) // subdivision year + 1
						),
						rs.getDouble(5) // area
				);
			}
		};
	}

	@Override
	protected void generateFile(File xmlFileDestination, List<LUDataPerYear> strataData) {
		XStream xStream = new XStream();
		xStream.alias("LandUse", LUDataPerYear.class);
		xStream.alias("Stratum", StratumPerYearData.class);
		String xmlSchema = xStream.toXML(strataData);
		System.out.println(xmlSchema);
		
		try (FileOutputStream outputStream = new FileOutputStream( xmlFileDestination ) ) {
			byte[] strToBytes = xmlSchema.getBytes();
			outputStream.write(strToBytes);
		} catch (Exception e) {
			logger.error("Error saving data to file", e);
		}
		
		CollectEarthUtils.openFile( xmlFileDestination);
	}
}

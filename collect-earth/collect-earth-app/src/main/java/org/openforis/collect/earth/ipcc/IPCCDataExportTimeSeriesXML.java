package org.openforis.collect.earth.ipcc;

import java.nio.charset.StandardCharsets;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import com.thoughtworks.xstream.XStream;

@Component
public class IPCCDataExportTimeSeriesXML extends AbstractIPCCDataExportTimeSeries {
	private static final String XML_DECLARATION = "<?xml version=" + (char) 34 + "1.0" + (char) 34 + " encoding=" + (char) 34 + "UTF-8" + (char) 34 + "?>\n";

	@Override
	protected RowMapper<LUSubdivisionDataPerYear> getRowMapper() {
		return new RowMapper<LUSubdivisionDataPerYear>() {
			@Override
			public LUSubdivisionDataPerYear mapRow(ResultSet rs, int rowNum) throws SQLException {
				
				String categoryInitial = rs.getString(1);
				String categoryFinal = rs.getString(2);
				String subdivInitial = rs.getString(3);
				String subdivFinal = rs.getString(4);
				
				return new LUSubdivisionDataPerYear(
						LandUseSubdivisionUtils.getSubdivision(categoryInitial, subdivInitial),
						LandUseSubdivisionUtils.getSubdivision(categoryFinal, subdivFinal),
						rs.getDouble(5) // area
						);
			}
		};
	}

	@Override
	protected File generateFile( List<StratumPerYearData> strataData) throws IOException {
		File xmlFileDestination = File.createTempFile("landUsesTimeseries", ".xml");
		xmlFileDestination.deleteOnExit();
		XStream xStream = new XStream();
		xStream.alias("LandUse", LUSubdivisionDataPerYear.class);
		xStream.alias("Stratum", StratumPerYearData.class);
		xStream.alias("Subdivision", AbstractLandUseSubdivision.class);
		
		xStream.setMode(XStream.NO_REFERENCES);
		String xmlSchema = xStream.toXML(strataData);
				
		try (FileOutputStream outputStream = new FileOutputStream( xmlFileDestination ) ) {
			// UTF-8, and say so in the file : with the charset of the machine an accented label of a code list was written in
			// one encoding and read as another, which makes the XML unreadable
			outputStream.write(XML_DECLARATION.getBytes(StandardCharsets.UTF_8));
			outputStream.write(xmlSchema.getBytes(StandardCharsets.UTF_8));
		} catch (IOException e) {
			// Do not hand back a half-written file : it used to be packaged and delivered as a finished export
			Files.deleteIfExists(xmlFileDestination.toPath());
			throw e;
		}
				
		return xmlFileDestination;
	}
}

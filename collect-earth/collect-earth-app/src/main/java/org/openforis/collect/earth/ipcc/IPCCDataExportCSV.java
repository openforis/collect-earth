package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

import org.openforis.collect.earth.app.service.RDBConnector;
import org.openforis.collect.earth.app.service.SchemaService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;

import com.opencsv.CSVWriter;

public abstract class IPCCDataExportCSV extends RDBConnector {

	@Autowired
	protected SchemaService schemaService;
	Logger logger = LoggerFactory.getLogger(IPCCDataExportCSV.class);

	public IPCCDataExportCSV() {
		super();
	}

	protected RowMapper<String[]> getRowMapper() {
		return new RowMapper<String[]>() {
			@Override
			public String[] mapRow(ResultSet rs, int rowNum) throws SQLException {
				int columnCount = rs.getMetaData().getColumnCount();
				String[] columns = new String[ columnCount ];
				for (int i = 1; i <= columnCount; i++) {
					columns[i-1] = rs.getString(i);
				}
				return columns;
			}
		};
	}

	protected File createCsv(List<String[]> luData) throws IOException {
		File csvDestination = File.createTempFile("TimeSeriesData", ".csv");
		csvDestination.deleteOnExit();
		try ( 
				FileWriter fw = new FileWriter(csvDestination); 
				CSVWriter csvWriter = new CSVWriter(fw)
				){
			
			for (String[] row : luData) {
				csvWriter.writeNext(row);
			}
	
		} catch (Exception e) {
			logger.error("Error generating CSV", e);
		}
		return csvDestination;
	}

}
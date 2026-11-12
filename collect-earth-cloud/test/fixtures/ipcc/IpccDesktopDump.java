// How the desktop's outputs here were made, with Collect Earth's own IPCC exporters (test/ipcc.test.ts compares the
// cloud's with them): plots.json (src/ipcc.ts ipccPlots of the plots of ../collect-import/ipcc-scenarios.summaries.json
// and of the desktop export, put in several strata and regions and given areas, with the survey's subdivisions and
// strata labels) goes into a SQLite database shaped as the one
// IPCCRDBGenerator makes (the plot table with a column per question, "-1" for a code not answered, and a table per
// code list with its default row -1 "N/A"), and the exporters are run on it.
//   javac -cp "<collect-earth-app/target/classes>;<earth-libs>/*" -d out IpccDesktopDump.java
//   java -cp "out;<collect-earth-app/target/classes>;<earth-libs>/*" IpccDesktopDump plots.json <folder to write to>
// The workbooks are written as JSON (each sheet's name and its rows of cell values).
import java.io.File;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RDBConnector;
import org.openforis.collect.earth.app.service.SchemaService;
import org.openforis.collect.earth.ipcc.IPCCDataExportLandUnitsCSV;
import org.openforis.collect.earth.ipcc.IPCCDataExportMatrixExcel;
import org.openforis.collect.earth.ipcc.IPCCDataExportMatrixExtendedExcel;
import org.openforis.collect.earth.ipcc.IPCCDataExportPerPlotCSV;
import org.openforis.collect.earth.ipcc.IPCCDataExportTimeSeriesToTool;
import org.openforis.collect.earth.ipcc.IPCCDataExportTimeSeriesXML;
import org.openforis.collect.earth.ipcc.IPCCLandUses;
import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandTypeEnum;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.ForestTypeEnum;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;
import org.openforis.collect.earth.ipcc.model.OtherlandSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementTypeEnum;
import org.openforis.collect.earth.ipcc.model.VegetationTypeEnum;
import org.openforis.collect.earth.ipcc.model.WetlandSubdivision;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

public class IpccDesktopDump {
	static final String[] TEMPLATE = { "land_use_subcategory", "land_use_subcategory_year_of_change", "land_use_subdivision",
			"land_use_subdivision_year_of_change", "land_use_initial_subdivision", "second_lu_subdivision", "second_lu_conversion",
			"second_lu_conversion_year" };
	static final String[] ANSWERS = { "subcategory", "changeYear", "subdivision", "subdivisionYear", "initialSubdivision",
			"secondSubdivision", "secondConversion", "secondYear" };
	static final String[][] STRATA = { { "climate", "climate_zones" }, { "soil", "soil_types" }, { "gez", "ecological_zones" } };

	public static void main(String[] args) throws Exception {
		JsonNode input = new ObjectMapper().readTree(new File(args[0]));
		File out = new File(args[1]);
		File db = File.createTempFile("ipcc", ".db");
		db.deleteOnExit();
		Connection connection = DriverManager.getConnection("jdbc:sqlite:" + db.getAbsolutePath());
		JdbcTemplate jdbc = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
		fill(connection, input);

		List<AbstractLandUseSubdivision> subdivisions = new ArrayList<>();
		for (JsonNode s : input.get("subdivisions")) {
			subdivisions.add(subdivision(s));
		}
		LandUseSubdivisionUtils.setLandUseSubdivisions(subdivisions);
		IPCCLandUses landUses = new IPCCLandUses();
		set(landUses, "landUseSubdivisions", subdivisions);

		write(out, "LU_Matrixes.json", workbookJson(wire(new IPCCDataExportMatrixExcel(), jdbc, null).generateTimeseriesData(2000, 2023)));
		write(out, "LU_Matrixes_stratified.json", workbookJson(wire(new IPCCDataExportMatrixExtendedExcel(), jdbc, null).generateTimeseriesData(2000, 2023)));
		write(out, "LU_Timeseries_per_plot.csv", Files.readString(wire(new IPCCDataExportPerPlotCSV(), jdbc, null).generateTimeseriesData(2000, 2023).toPath()));
		write(out, "LU_Timeseries_grouped.csv", Files.readString(wire(new IPCCDataExportLandUnitsCSV(), jdbc, null).generateTimeseriesData(2000, 2023).toPath()));
		write(out, "LU_Timeseries.xml", Files.readString(wire(new IPCCDataExportTimeSeriesXML(), jdbc, null).generateTimeseriesData(2000, 2023).toPath()));
		write(out, "GHGi_tool_data.xml", Files.readString(wire(new IPCCDataExportTimeSeriesToTool(), jdbc, landUses).generateTimeseriesData(2000, 2000, 2023, "ALG", "province").toPath()));
	}

	/** A subdivision with the management type its category gets by default (IPCCLandUses) */
	static AbstractLandUseSubdivision subdivision(JsonNode s) {
		String code = s.get("code").asText();
		String name = s.get("name").asText();
		int id = s.get("id").asInt();
		switch (s.get("category").asText()) {
		case "F":
			return new ForestSubdivision(code, name, ManagementTypeEnum.valueOf(s.get("management").asText()), id, ForestTypeEnum.OTHER_CONIF);
		case "C":
			return new CroplandSubdivision(code, name, CroplandTypeEnum.valueOf(s.get("management").asText()), id);
		case "G":
			return new GrasslandSubdivision(code, name, ManagementTypeEnum.valueOf(s.get("management").asText()), id, VegetationTypeEnum.SV);
		case "S":
			return new SettlementSubdivision(code, name, SettlementTypeEnum.valueOf(s.get("management").asText()), id);
		case "W":
			return new WetlandSubdivision(code, name, ManagementTypeEnum.valueOf(s.get("management").asText()), id);
		default:
			return new OtherlandSubdivision(code, name, ManagementTypeEnum.valueOf(s.get("management").asText()), id);
		}
	}

	static void fill(Connection connection, JsonNode input) throws Exception {
		Map<String, Map<String, Integer>> ids = new LinkedHashMap<>();
		try (Statement st = connection.createStatement()) {
			StringBuilder columns = new StringBuilder("id TEXT, actively_saved INTEGER, round INTEGER, expansion_factor REAL, province TEXT, ipcc_current_category TEXT, ipcc_current_subdivision TEXT, ipcc_previous_category TEXT");
			for (String column : TEMPLATE) {
				columns.append(", ").append(column).append(" TEXT");
			}
			for (String[] s : STRATA) {
				columns.append(", ").append(s[0]).append(" TEXT, ").append(s[0]).append("_code_id INTEGER");
				String table = s[1] + "_code";
				st.execute("CREATE TABLE " + table + " (" + table + "_id INTEGER, " + s[1] + " TEXT, " + s[1] + "_label TEXT, " + s[1] + "_desc TEXT)");
				Map<String, Integer> byCode = new LinkedHashMap<>();
				st.execute("INSERT INTO " + table + " VALUES (-1, '-1', 'N/A', NULL)");
				int n = 1;
				for (JsonNode item : input.get("labels").get(s[0])) {
					byCode.put(item.get(0).asText(), n);
					try (PreparedStatement ps = connection.prepareStatement("INSERT INTO " + table + " VALUES (?, ?, ?, ?)")) {
						ps.setInt(1, n++);
						ps.setString(2, item.get(0).asText());
						ps.setString(3, item.get(1).asText());
						ps.setString(4, item.get(1).asText() + " description");
						ps.execute();
					}
				}
				ids.put(s[0], byCode);
			}
			for (int year = 2000; year <= 2023; year++) {
				columns.append(", ipcc_" + year + "_category TEXT, ipcc_" + year + "_subdivision TEXT");
			}
			st.execute("CREATE TABLE plot (" + columns + ")");
		}
		for (JsonNode p : input.get("plots")) {
			Map<String, Object> row = new LinkedHashMap<>();
			JsonNode a = p.get("answers");
			String subcategory = a.get("subcategory").asText();
			row.put("id", p.get("id").asText());
			row.put("actively_saved", 1);
			row.put("round", 1);
			row.put("expansion_factor", p.get("area").isNull() ? null : p.get("area").asDouble());
			row.put("province", p.get("province").asText().isEmpty() ? null : p.get("province").asText());
			row.put("ipcc_current_category", code(subcategory.length() > 1 ? subcategory.substring(1, 2) : ""));
			row.put("ipcc_current_subdivision", code(a.get("subdivision").asText()));
			row.put("ipcc_previous_category", code(subcategory.length() > 0 ? subcategory.substring(0, 1) : ""));
			for (int i = 0; i < TEMPLATE.length; i++) {
				row.put(TEMPLATE[i], code(a.get(ANSWERS[i]).asText()));
			}
			for (String[] s : STRATA) {
				String value = a.get(s[0]).asText();
				Integer id = ids.get(s[0]).get(value);
				row.put(s[0], id == null ? "-1" : value);
				row.put(s[0] + "_code_id", id == null ? -1 : id);
			}
			for (int year = 2000; year <= 2023; year++) {
				JsonNode y = p.get("years").get(year - 2000);
				row.put("ipcc_" + year + "_category", code(y.get("category").asText()));
				row.put("ipcc_" + year + "_subdivision", code(y.get("subdivision").asText()));
			}
			String sql = "INSERT INTO plot (" + String.join(", ", row.keySet()) + ") VALUES (" + "?, ".repeat(row.size() - 1) + "?)";
			try (PreparedStatement ps = connection.prepareStatement(sql)) {
				int i = 1;
				for (Object v : row.values()) {
					ps.setObject(i++, v);
				}
				ps.execute();
			}
		}
	}

	/** A code as the database holds it: "-1" when not answered */
	static String code(String v) {
		return v.isEmpty() ? "-1" : v;
	}

	/** The exporter on the database, with no schema (SQLite) */
	static <T extends RDBConnector> T wire(T exporter, JdbcTemplate jdbc, IPCCLandUses landUses) throws Exception {
		SchemaService schema = new SchemaService() {
			@Override
			public String getSchemaPrefix(ExportType exportType) {
				return "";
			}
		};
		for (Class<?> c = exporter.getClass(); c != Object.class; c = c.getSuperclass()) {
			for (Field f : c.getDeclaredFields()) {
				f.setAccessible(true);
				if (f.getType() == SchemaService.class) {
					f.set(exporter, schema);
				} else if (f.getType() == JdbcTemplate.class) {
					f.set(exporter, jdbc);
				} else if (f.getType() == IPCCLandUses.class) {
					f.set(exporter, landUses);
				}
			}
		}
		return exporter;
	}

	static void set(Object target, String field, Object value) throws Exception {
		Field f = target.getClass().getDeclaredField(field);
		f.setAccessible(true);
		f.set(target, value);
	}

	static String workbookJson(File file) throws Exception {
		List<Map<String, Object>> sheets = new ArrayList<>();
		try (Workbook workbook = WorkbookFactory.create(file)) {
			for (Sheet sheet : workbook) {
				List<List<Object>> rows = new ArrayList<>();
				for (int r = 0; r <= sheet.getLastRowNum(); r++) {
					Row row = sheet.getRow(r);
					List<Object> cells = new ArrayList<>();
					if (row != null) {
						for (int c = 0; c < row.getLastCellNum(); c++) {
							Cell cell = row.getCell(c);
							cells.add(cell == null ? null : cell.getCellType() == CellType.NUMERIC ? (Object) cell.getNumericCellValue() : cell.getStringCellValue());
						}
					}
					rows.add(cells);
				}
				Map<String, Object> entry = new LinkedHashMap<>();
				entry.put("title", sheet.getSheetName());
				entry.put("rows", rows);
				sheets.add(entry);
			}
		}
		return new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT).writeValueAsString(sheets);
	}

	static void write(File folder, String name, String text) throws Exception {
		Files.write(new File(folder, name).toPath(), text.replace("\r\n", "\n").getBytes(StandardCharsets.UTF_8));
	}
}

package org.openforis.collect.earth.app.service.data;

/**
 * What the export dialog asks for (POST /api/jobs/export): the format, which records, and where to. The dates are
 * yyyy-MM-dd; the attribute is the id of one of ExportService.options()'s (KEY:0, SUMMARY:1...).
 */
public class ExportRequest {

	/** The formats of the Data menu; the tag is what the Swing file name carried (DataFormat.name()). */
	public enum Format {
		CSV("csv", "CSV"), XML("zip", "ZIP_WITH_XML"), BACKUP("collect-data", "COLLECT_BACKUP"), KML("kml", "KML_FILE");

		private final String extension;
		private final String tag;

		Format(String extension, String tag) {
			this.extension = extension;
			this.tag = tag;
		}

		public String getExtension() {
			return extension;
		}

		public String getTag() {
			return tag;
		}
	}

	/** Which records (ExportActionListener.RecordsToExport). */
	public enum Records {
		ALL, SINCE_LAST_EXPORT, FROM_DATE, BY_ATTRIBUTE
	}

	public Format format = Format.XML;
	public Records records = Records.ALL;
	/** yyyy-MM-dd, for FROM_DATE */
	public String fromDate;
	/** The id of the attribute, for BY_ATTRIBUTE */
	public String attribute;
	/** The value the attribute must have, * as a wildcard, for BY_ATTRIBUTE */
	public String value;
	/** CSV: a column with the label of each code attribute next to the code */
	public boolean includeLabels;
	/** The file to write */
	public String path;
}

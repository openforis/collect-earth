package org.openforis.collect.earth.app.service.data;

import java.io.File;
import java.text.DateFormat;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.data.ExportRequest.Format;
import org.openforis.collect.earth.app.service.data.ExportRequest.Records;
import org.openforis.collect.earth.app.service.jobs.Job;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.io.data.DataExportStatus;
import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.collect.manager.process.ProcessStatus;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * The exports of the Data menu, as the export dialog of the page asks for them: what ExportActionListener and
 * ExportProcessMonitorDialog did (the processes of DataImportExportService, the KML export, the file name, the date
 * of the last export), as a job.
 */
@Service
public class ExportService {

	/**
	 * Collect only stores the first key and summary attributes of the root entity as searchable columns (KEY1..KEY3 and
	 * SUMMARY1..SUMMARY3) of the record table, so only those can be used to filter the records to export.
	 */
	static final int MAX_FILTERABLE_ATTRIBUTES = 3;

	/** The request is not one that can be exported: its code names the field, its message says what to do. */
	public static class InvalidExportException extends Exception {
		private static final long serialVersionUID = 1L;
		private final String code;

		public InvalidExportException(String code, String message) {
			super(message);
			this.code = code;
		}

		public String getCode() {
			return code;
		}
	}

	/** A key or summary attribute of the root entity the records can be filtered by: its id is TYPE:position. */
	public static final class Attribute {
		public enum Type {
			KEY, SUMMARY
		}

		private final AttributeDefinition definition;
		private final Type type;
		private final int position;
		private final String label;

		Attribute(AttributeDefinition definition, Type type, int position, String label) {
			this.definition = definition;
			this.type = type;
			this.position = position;
			this.label = label;
		}

		public String getId() {
			return type + ":" + position;
		}

		public Type getType() {
			return type;
		}

		public int getPosition() {
			return position;
		}

		public String getName() {
			return definition.getName();
		}

		/**
		 * The values to filter by, positional: the record search ignores blank values, so the positions before the
		 * attribute's match any value.
		 */
		List<String> positionedValues(String value) {
			List<String> values = new ArrayList<>();
			for (int i = 0; i < position; i++) {
				values.add("");
			}
			values.add(value);
			return values;
		}

		Map<String, Object> toJson() {
			Map<String, Object> json = new LinkedHashMap<>();
			json.put("id", getId());
			json.put("label", label);
			json.put("name", getName());
			json.put("type", type.name());
			json.put("position", position);
			return json;
		}
	}

	private final DataImportExportService data;
	private final EarthSurveyService surveys;
	private final KmlGeneratorService kml;
	private final LocalPropertiesService properties;
	private final Supplier<Date> now;

	@Autowired
	public ExportService(DataImportExportService data, EarthSurveyService surveys, KmlGeneratorService kml, LocalPropertiesService properties) {
		this(data, surveys, kml, properties, Date::new);
	}

	/** For the tests: the clock the file names carry. */
	public ExportService(DataImportExportService data, EarthSurveyService surveys, KmlGeneratorService kml, LocalPropertiesService properties,
			Supplier<Date> now) {
		this.data = data;
		this.surveys = surveys;
		this.kml = kml;
		this.properties = properties;
		this.now = now;
	}

	/** What the dialog offers: the formats, the attributes to filter by, the last export and the survey. */
	public Map<String, Object> options() {
		Map<String, Object> options = new LinkedHashMap<>();
		List<String> formats = new ArrayList<>();
		for (Format format : Format.values()) {
			formats.add(format.name());
		}
		options.put("formats", formats);
		List<Map<String, Object>> attributes = new ArrayList<>();
		for (Attribute attribute : attributes()) {
			attributes.add(attribute.toJson());
		}
		options.put("attributes", attributes);
		Date lastExport = properties.getLastExportedDate(surveyName());
		options.put("lastExport", lastExport == null ? null : lastExport.getTime());
		options.put("survey", surveyName());
		return options;
	}

	/**
	 * The key and the summary attributes of the survey the records can be filtered by, in the order Collect stores
	 * them in the key and summary columns of the record table; none without a survey.
	 */
	public List<Attribute> attributes() {
		List<Attribute> attributes = new ArrayList<>();
		CollectSurvey survey = surveys.getCollectSurvey();
		EntityDefinition root = survey == null ? null : surveys.getRootEntityDefinition();
		if (root == null) {
			return attributes;
		}
		String language = properties.getUiLanguage().getLocale().getLanguage();
		add(attributes, root.getKeyAttributeDefinitions(), Attribute.Type.KEY, Messages.getString("ExportActionListener.9"), language);
		add(attributes, survey.getSchema().getSummaryAttributeDefinitions(root), Attribute.Type.SUMMARY,
				Messages.getString("ExportActionListener.10"), language);
		return attributes;
	}

	private static void add(List<Attribute> attributes, List<AttributeDefinition> definitions, Attribute.Type type, String typeLabel,
			String language) {
		if (definitions == null) {
			return;
		}
		for (int position = 0; position < definitions.size() && position < MAX_FILTERABLE_ATTRIBUTES; position++) {
			AttributeDefinition definition = definitions.get(position);
			attributes.add(new Attribute(definition, type, position, definition.getFailSafeLabel(language) + " (" + typeLabel + ")"));
		}
	}

	private Attribute attribute(String id) {
		for (Attribute attribute : attributes()) {
			if (attribute.getId().equals(id)) {
				return attribute;
			}
		}
		return null;
	}

	private String surveyName() {
		CollectSurvey survey = surveys.getCollectSurvey();
		return survey == null ? "" : survey.getName();
	}

	/** Whether the format offers this choice of records: the Swing menu had the four for XML, two for the backup, one for the rest. */
	public static boolean allows(Format format, Records records) {
		switch (format) {
		case XML:
			return true;
		case BACKUP:
			return records == Records.ALL || records == Records.FROM_DATE;
		default:
			return records == Records.ALL;
		}
	}

	/** The records modified since when: the last export, the date given, or null for all. Null too without a last export. */
	private Date modifiedSince(ExportRequest request) throws InvalidExportException {
		if (request.records == Records.SINCE_LAST_EXPORT) {
			return properties.getLastExportedDate(surveyName());
		}
		if (request.records == Records.FROM_DATE) {
			try {
				return Date.from(LocalDate.parse(StringUtils.trimToEmpty(request.fromDate)).atStartOfDay(ZoneId.systemDefault()).toInstant());
			} catch (DateTimeParseException e) {
				throw new InvalidExportException("export.date", Messages.getString("DataPage.export.noDate"));
			}
		}
		return null;
	}

	/** The checks before anything is written; the file name needs the same ones but the path. */
	private Attribute check(ExportRequest request, boolean withPath) throws InvalidExportException {
		if (request.format == null || request.records == null) {
			throw new InvalidExportException("export.format", Messages.getString("DataPage.export.recordsNotAllowed"));
		}
		if (surveys.getCollectSurvey() == null) {
			throw new InvalidExportException("export.noSurvey", Messages.getString("DataPage.export.noSurvey"));
		}
		if (!allows(request.format, request.records)) {
			throw new InvalidExportException("export.records", Messages.getString("DataPage.export.recordsNotAllowed"));
		}
		if (withPath && StringUtils.isBlank(request.path)) {
			throw new InvalidExportException("export.path", Messages.getString("DataPage.export.noPath"));
		}
		modifiedSince(request);
		Attribute attribute = null;
		if (request.records == Records.BY_ATTRIBUTE) {
			if (attributes().isEmpty()) {
				throw new InvalidExportException("export.attribute", Messages.getString("ExportActionListener.7"));
			}
			attribute = attribute(request.attribute);
			if (attribute == null) {
				throw new InvalidExportException("export.attribute", Messages.getString("DataPage.export.noAttribute"));
			}
			if (StringUtils.isBlank(request.value)) {
				throw new InvalidExportException("export.value", Messages.getString("ExportActionListener.8"));
			}
		}
		return attribute;
	}

	/**
	 * The name the save dialog starts from, as the Swing one did: the operator, the survey, the attribute and value of
	 * a filter, the dates, the format.
	 */
	public String fileName(ExportRequest request) throws InvalidExportException {
		Attribute attribute = check(request, false);
		StringBuilder name = new StringBuilder(toFileNameSafe(properties.getOperator())).append("_collectedData_").append(surveyName());
		if (attribute != null) {
			name.append("_").append(toFileNameSafe(attribute.getName())).append("_").append(toFileNameSafe(request.value));
		}
		DateFormat dateFormat = new SimpleDateFormat("ddMMyy_HHmmss");
		Date since = modifiedSince(request);
		if (since == null) {
			name.append("_on_").append(dateFormat.format(now.get()));
		} else {
			name.append("_").append(dateFormat.format(since)).append("_to_").append(dateFormat.format(now.get()));
		}
		return name.append("_").append(request.format.getTag()).append(".").append(request.format.getExtension()).toString();
	}

	/** Without the accents and the characters a file name cannot carry. */
	static String toFileNameSafe(String text) {
		if (text == null) {
			return "";
		}
		String fileName = Normalizer.normalize(StringUtils.deleteWhitespace(text), Normalizer.Form.NFD).replaceAll("[^\\p{ASCII}]", "");
		return fileName.replaceAll("[^a-zA-Z0-9]", "");
	}

	/**
	 * The export as a job, checked first so a bad request is refused before the job starts. The result is
	 * {@code {path, records}}. A finished export of the records modified since the last export records this one as
	 * the last.
	 */
	public Job export(ExportRequest request) throws InvalidExportException {
		Attribute attribute = check(request, true);
		Date since = modifiedSince(request);
		File file = new File(request.path.trim());
		return context -> {
			long records = 0;
			if (request.format == Format.KML) {
				context.progress(-1, Messages.getString("ExportDialogProcessMonitor.0"));
				kml.exportToKml(file);
			} else {
				AbstractProcess<Void, DataExportStatus> process;
				switch (request.format) {
				case CSV:
					process = data.exportSurveyAsCsv(file, request.includeLabels);
					break;
				case BACKUP:
					process = data.exportSurveyAsBackup(file);
					break;
				default:
					process = data.exportSurveyAsZipWithXml(file, since, attribute == null || attribute.getType() != Attribute.Type.KEY ? null
							: attribute.positionedValues(request.value.trim()),
							attribute == null || attribute.getType() != Attribute.Type.SUMMARY ? null : attribute.positionedValues(request.value.trim()));
				}
				ProcessStatus status = ProcessJobs.run(process, context, Messages.getString("ExportDialogProcessMonitor.4"));
				if (status != null) {
					records = status.getProcessed();
					if (!status.isComplete()) {
						// Cancelled: what was written stays, as before, but it is no export to count from
						return result(file, records);
					}
				}
			}
			if (request.format == Format.XML && request.records == Records.SINCE_LAST_EXPORT) {
				properties.setLastExportedDate(surveyName());
			}
			return result(file, records);
		};
	}

	private static Map<String, Object> result(File file, long records) {
		Map<String, Object> result = new LinkedHashMap<>();
		result.put("path", file.getAbsolutePath());
		result.put("records", records);
		return result;
	}
}

package org.openforis.collect.earth.app.service.cloud;

import java.io.IOException;
import java.io.StringReader;
import java.io.StringWriter;
import java.util.Collections;
import java.util.Date;
import java.util.Map;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.core.handlers.BalloonInputFieldsUtils;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.persistence.xml.DataMarshaller;
import org.openforis.collect.persistence.xml.DataUnmarshaller;
import org.openforis.collect.persistence.xml.DataUnmarshaller.ParseRecordResult;
import org.openforis.collect.earth.app.service.PlotTimeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Converts Collect records to/from the cloud sync wire format: the record XML
 * produced by Collect's DataMarshaller (full fidelity, version-stable — unlike
 * the Protostuff blob stored in the local database, which is only decodable by
 * a matching collect-core version) plus a flattened balloon-parameter map used
 * by server dashboards without parsing the XML.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
@Component
public class CloudRecordSerializer {

	public static final int PAYLOAD_VERSION = 1;

	private final BalloonInputFieldsUtils balloonInputFieldsUtils = new BalloonInputFieldsUtils();

	/** The active time spent on each plot, sent with its record; absent in tests and tools. */
	@Autowired(required = false)
	private PlotTimeService plotTimes;

	/** One record (or deletion tombstone) as uploaded to the cloud service. */
	public static class RecordEnvelope {
		private final String recordKey;
		private final String surveyUri;
		private final String operator;
		private final Date modifiedOn;
		private final boolean activelySaved;
		private final int step;
		private final String xml;
		private final Map<String, String> summary;
		private final boolean deleted;
		/** Seconds of active work on the plot counted on this machine (PlotTimeService), or null when unknown. */
		private final Integer activeSeconds;

		RecordEnvelope(String recordKey, String surveyUri, String operator, Date modifiedOn, boolean activelySaved,
				int step, String xml, Map<String, String> summary, boolean deleted) {
			this(recordKey, surveyUri, operator, modifiedOn, activelySaved, step, xml, summary, deleted, null);
		}

		RecordEnvelope(String recordKey, String surveyUri, String operator, Date modifiedOn, boolean activelySaved,
				int step, String xml, Map<String, String> summary, boolean deleted, Integer activeSeconds) {
			this.activeSeconds = activeSeconds;
			this.recordKey = recordKey;
			this.surveyUri = surveyUri;
			this.operator = operator;
			this.modifiedOn = modifiedOn;
			this.activelySaved = activelySaved;
			this.step = step;
			this.xml = xml;
			this.summary = summary;
			this.deleted = deleted;
		}

		public String getRecordKey() {
			return recordKey;
		}

		public String getSurveyUri() {
			return surveyUri;
		}

		public String getOperator() {
			return operator;
		}

		public Date getModifiedOn() {
			return modifiedOn;
		}

		public boolean isActivelySaved() {
			return activelySaved;
		}

		public int getStep() {
			return step;
		}

		public String getXml() {
			return xml;
		}

		public Map<String, String> getSummary() {
			return summary;
		}

		public boolean isDeleted() {
			return deleted;
		}

		public int getPayloadVersion() {
			return PAYLOAD_VERSION;
		}

		/**
		 * The same envelope under another operator: the local dashboard stores the records under its one account
		 * (the ready line's username), so they are sent with that name.
		 */
		public RecordEnvelope withOperator(String newOperator) {
			return new RecordEnvelope(recordKey, surveyUri, newOperator, modifiedOn, activelySaved, step, xml, summary,
					deleted, activeSeconds);
		}

		public Integer getActiveSeconds() {
			return activeSeconds;
		}
	}

	/** Serializes a record loaded from the local database into its upload envelope. */
	public RecordEnvelope serialize(CollectRecord record, String recordKey, String surveyUri) throws IOException {
		StringWriter writer = new StringWriter();
		try {
			new DataMarshaller().write(record, writer);
		} catch (Exception e) {
			throw new IOException("Error marshalling record " + recordKey + " to XML", e); //$NON-NLS-1$ //$NON-NLS-2$
		}
		Map<String, String> summary = balloonInputFieldsUtils.getValuesByHtmlParameters(record.getRootEntity());
		String operator = summary.get(EarthConstants.OPERATOR_PARAMETER);
		boolean activelySaved = Boolean.parseBoolean(summary.get(EarthConstants.ACTIVELY_SAVED_PARAMETER));
		Integer activeSeconds = plotTimes == null ? null : plotTimes.activeSeconds(surveyUri, recordKey);
		return new RecordEnvelope(recordKey, surveyUri, operator, record.getModifiedDate(), activelySaved,
				record.getStep().getStepNumber(), writer.toString(), summary, false, activeSeconds);
	}

	/** A deletion marker: no XML/summary payload, the server soft-deletes the record. */
	public static RecordEnvelope tombstone(String recordKey, String surveyUri, String operator, Date deletedOn) {
		return new RecordEnvelope(recordKey, surveyUri, operator, deletedOn, false, 0, null,
				Collections.<String, String> emptyMap(), true);
	}

	/** Parses record XML (as downloaded from the cloud) back into a CollectRecord. */
	public CollectRecord deserialize(String xml, CollectSurvey survey) throws IOException {
		ParseRecordResult result = new DataUnmarshaller(survey).parse(new StringReader(xml));
		if (!result.isSuccess() || result.getRecord() == null) {
			throw new IOException("Error parsing record XML: " + result.getFailures()); //$NON-NLS-1$
		}
		return result.getRecord();
	}
}

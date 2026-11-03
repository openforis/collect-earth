package org.openforis.collect.earth.app.service.dashboard;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService.PlotStatus;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.RecordFilter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** The desktop's project and records, for the local dashboard. */
@Component
public class EarthDashboardFeedSource implements DashboardFeedSource {

	@Autowired
	private EarthSurveyService earthSurveyService;
	@Autowired
	private LocalPropertiesService localPropertiesService;
	@Autowired
	private RecordManager recordManager;
	@Autowired
	private CloudRecordSerializer serializer;

	@Override
	public String surveyUri() {
		CollectSurvey survey = earthSurveyService.getCollectSurvey();
		return survey == null ? null : survey.getUri();
	}

	@Override
	public String projectName() {
		String name = localPropertiesService.getValue(EarthProperty.SURVEY_NAME);
		if (StringUtils.isBlank(name)) {
			CollectSurvey survey = earthSurveyService.getCollectSurvey();
			name = survey == null ? null : survey.getName();
		}
		return StringUtils.abbreviate(StringUtils.trimToNull(name), 200);
	}

	@Override
	public String operator() {
		return localPropertiesService.getOperator();
	}

	@Override
	public File projectFolder() {
		String imd = localPropertiesService.getImdFile();
		return StringUtils.isBlank(imd) ? null : new File(imd).getAbsoluteFile().getParentFile();
	}

	@Override
	public File plotFile() {
		String csv = localPropertiesService.getCsvFile();
		return StringUtils.isBlank(csv) ? null : new File(csv);
	}

	@Override
	public List<Integer> recordIds() {
		CollectSurvey survey = earthSurveyService.getCollectSurvey();
		List<Integer> ids = new ArrayList<>();
		if (survey == null) {
			return ids;
		}
		for (CollectRecordSummary summary : recordManager
				.loadSummaries(new RecordFilter(survey, EarthConstants.ROOT_ENTITY_NAME))) {
			ids.add(summary.getId());
		}
		return ids;
	}

	@Override
	public RecordEnvelope load(int recordId) throws IOException {
		CollectSurvey survey = earthSurveyService.getCollectSurvey();
		// Not validated: the dashboard reads the answers, and validating is most of the loading time
		CollectRecord record = recordManager.load(survey, recordId, Step.ENTRY, false);
		return started(record) ? serialize(record) : null;
	}

	@Override
	public RecordEnvelope loadByKey(String recordKey) throws IOException {
		CollectRecord record = earthSurveyService.loadRecord(recordKey.split(","), false); //$NON-NLS-1$
		return started(record) ? serialize(record) : null;
	}

	/**
	 * Whether the plot of a record counts as started, by the desktop's own rule (AbstractEarthSurveyService
	 * getPlotStatus): a record holding nothing the collector answered - one older versions stored on merely opening the
	 * plot - is left out, so the dashboard's "not started" and "started" are the desktop's.
	 */
	static boolean started(CollectRecord record) {
		return record != null && AbstractEarthSurveyService.getPlotStatus(record) != PlotStatus.NOT_STARTED;
	}

	private RecordEnvelope serialize(CollectRecord record) throws IOException {
		String key = String.join(",", record.getRootEntityKeyValues()); //$NON-NLS-1$
		return serializer.serialize(record, key, surveyUri());
	}
}

package org.openforis.collect.earth.app.service.cloud;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService.PlotStatus;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.RecordFilter;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.TextAttribute;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * The plots of a survey this computer's database holds, by the name they were saved under (the operator), whatever
 * project is open: what joining a cloud project with that survey would bring into it (CloudService asks first when
 * some are other people's). Plots opened and never answered are not counted.
 */
@Component
public class RecordsHereByName implements CloudService.RecordsByName {

	@Autowired
	private SurveyManager surveyManager;

	@Autowired
	private RecordManager recordManager;

	@Override
	public Map<String, Integer> of(String surveyName) {
		Map<String, Integer> byName = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
		// As EarthSurveyService names the surveys it imports
		CollectSurvey survey = surveyManager.get(EarthConstants.EARTH_SURVEY_NAME + surveyName);
		if (survey == null) {
			return byName;
		}
		for (CollectRecordSummary summary : recordManager.loadSummaries(new RecordFilter(survey, EarthConstants.ROOT_ENTITY_NAME))) {
			// Not validated: only the operator is read
			CollectRecord record = recordManager.load(survey, summary.getId(), Step.ENTRY, false);
			if (record == null || AbstractEarthSurveyService.getPlotStatus(record) == PlotStatus.NOT_STARTED) {
				continue;
			}
			byName.merge(operatorOf(record), 1, Integer::sum);
		}
		return byName;
	}

	/** The name the plot was saved under, "" when none */
	static String operatorOf(CollectRecord record) {
		List<Node<? extends NodeDefinition>> nodes = record.getRootEntity() == null ? null
				: record.getRootEntity().getChildren(EarthConstants.OPERATOR_ATTRIBUTE_NAME);
		if (nodes == null || nodes.isEmpty() || !(nodes.get(0) instanceof TextAttribute)) {
			return ""; //$NON-NLS-1$
		}
		return StringUtils.trimToEmpty(((TextAttribute) nodes.get(0)).getText());
	}
}

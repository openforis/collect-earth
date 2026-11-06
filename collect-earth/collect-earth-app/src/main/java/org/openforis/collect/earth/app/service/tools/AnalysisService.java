package org.openforis.collect.earth.app.service.tools;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.IPCCGeneratorService;
import org.openforis.collect.earth.app.service.jobs.Job;
import org.openforis.collect.earth.app.service.jobs.JobProgress;
import org.openforis.collect.earth.app.service.tools.ToolsService.InvalidToolRequestException;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.CountryCode;
import org.openforis.collect.earth.ipcc.model.CountryUtils;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.NodeDefinition;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * The LULUCF (IPCC GHGi) package of the Tools menu as jobs, which the Swing IPCCGeneratorListener drove with its dialogs.
 * It goes in two jobs, the subdivision form of the page between them (IpccForm). The analysis of the data itself is the
 * dashboard's page (Tools, Analyse the data), which replaced Saiku.
 */
@Service
public class AnalysisService {

	private final IPCCGeneratorService ipcc;
	private final EarthSurveyService surveys;
	private final Supplier<CountryCode[]> countries;

	@Autowired
	public AnalysisService(IPCCGeneratorService ipcc, EarthSurveyService surveys) {
		this(ipcc, surveys, CountryUtils::getCountryList);
	}

	/** For the tests: the countries stood in for. */
	public AnalysisService(IPCCGeneratorService ipcc, EarthSurveyService surveys, Supplier<CountryCode[]> countries) {
		this.ipcc = ipcc;
		this.surveys = surveys;
		this.countries = countries;
	}

	/** What the dialog asks before starting: whether the database was generated before (then refresh or reuse). */
	public Map<String, Object> analysis() {
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("ipccGenerated", ipcc.isRdbAlreadyGenerated(ExportType.IPCC));
		answer.put("survey", surveys.getCollectSurvey() != null);
		return answer;
	}

	private void needSurvey() throws InvalidToolRequestException {
		if (surveys.getCollectSurvey() == null) {
			throw new InvalidToolRequestException("tools.noSurvey", Messages.getString("DataPage.export.noSurvey"));
		}
	}

	/** The first job of the LULUCF package: the database generated or restored; the result is the form (IpccForm). */
	public Job ipccPrepare(boolean refresh) throws InvalidToolRequestException {
		needSurvey();
		return context -> {
			JobProgress progress = new JobProgress(context);
			progress.setMessage(Messages.getString("IPCCGeneratorListener.2"));
			ipcc.setUserCancelledOperation(false);
			ipcc.setRefreshDatabase(refresh);
			ipcc.prepareDatabase(progress);
			return form().toJson();
		};
	}

	private IpccForm form() {
		List<AbstractLandUseSubdivision> subdivisions = ipcc.getLandUseSubdivisions();
		return new IpccForm(subdivisions == null ? Collections.emptyList() : subdivisions, attributeNames(), countries.get());
	}

	/** The attributes of the plot entity, one of which holds the region (CountryPage) */
	private List<String> attributeNames() {
		CollectSurvey survey = surveys.getCollectSurvey();
		List<String> names = new ArrayList<>();
		if (survey != null) {
			for (NodeDefinition child : survey.getSchema().getFirstRootEntityDefinition().getChildDefinitions()) {
				names.add(child.getName());
			}
		}
		return names;
	}

	/** The second job: the answers of the form applied, the outputs produced into the ZIP; the result is {@code {path}}. */
	public Job ipccOutputs(IpccAnswers answers) throws InvalidToolRequestException {
		needSurvey();
		IpccForm form = form();
		form.apply(answers);
		if (StringUtils.isBlank(answers.path)) {
			throw new InvalidToolRequestException("export.path", Messages.getString("DataPage.export.noPath"));
		}
		File zip = new File(answers.path.trim());
		return context -> {
			ipcc.setUserCancelledOperation(false);
			ipcc.produceOutputs(answers.country, answers.regionAttribute, zip, new JobProgress(context));
			return Collections.singletonMap("path", zip.getAbsolutePath());
		};
	}
}

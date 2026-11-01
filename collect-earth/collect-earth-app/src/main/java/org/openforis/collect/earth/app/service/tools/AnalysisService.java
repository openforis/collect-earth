package org.openforis.collect.earth.app.service.tools;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.IPCCGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.jobs.Job;
import org.openforis.collect.earth.app.service.jobs.JobProgress;
import org.openforis.collect.earth.app.service.tools.ToolsService.InvalidToolRequestException;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.ipcc.RdbExportException;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.CountryCode;
import org.openforis.collect.earth.ipcc.model.CountryUtils;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.NodeDefinition;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * The analysis entries of the Tools menu as jobs: Saiku, the stand-alone Saiku tool and the LULUCF (IPCC GHGi)
 * package, which the Swing GenerateDatabaseStarter, SaikuToolExportListener and IPCCGeneratorListener drove with
 * their dialogs. The LULUCF package goes in two jobs, the subdivision form of the page between them (IpccForm).
 */
@Service
public class AnalysisService {

	private final AnalysisSaikuService saiku;
	private final IPCCGeneratorService ipcc;
	private final EarthSurveyService surveys;
	private final LocalPropertiesService properties;
	private final Supplier<CountryCode[]> countries;
	private final boolean saikuToolAvailable;

	@Autowired
	public AnalysisService(AnalysisSaikuService saiku, IPCCGeneratorService ipcc, EarthSurveyService surveys, LocalPropertiesService properties) {
		// The stand-alone tool bundles the Windows scripts and Java of the installation: the Swing entry was Windows only
		this(saiku, ipcc, surveys, properties, CountryUtils::getCountryList, SystemUtils.IS_OS_WINDOWS);
	}

	/** For the tests: the countries and the platform stood in for. */
	public AnalysisService(AnalysisSaikuService saiku, IPCCGeneratorService ipcc, EarthSurveyService surveys, LocalPropertiesService properties,
			Supplier<CountryCode[]> countries, boolean saikuToolAvailable) {
		this.saiku = saiku;
		this.ipcc = ipcc;
		this.surveys = surveys;
		this.properties = properties;
		this.countries = countries;
		this.saikuToolAvailable = saikuToolAvailable;
	}

	/** What the dialogs ask before starting: whether a database was generated before (then refresh or reuse), and what is available. */
	public Map<String, Object> analysis() {
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("saikuGenerated", saiku.isRdbAlreadyGenerated(ExportType.SAIKU));
		answer.put("ipccGenerated", ipcc.isRdbAlreadyGenerated(ExportType.IPCC));
		answer.put("saikuToolAvailable", saikuToolAvailable);
		String folder = properties.getSaikuFolder();
		answer.put("saikuFolderSet", StringUtils.isNotBlank(folder) && saiku.isSaikuFolder(new File(folder)));
		answer.put("survey", surveys.getCollectSurvey() != null);
		return answer;
	}

	private void needSurvey() throws InvalidToolRequestException {
		if (surveys.getCollectSurvey() == null) {
			throw new InvalidToolRequestException("tools.noSurvey", Messages.getString("DataPage.export.noSurvey"));
		}
	}

	/** Saiku: the database generated or restored, the server started and opened in the browser; the result is {@code {opened: true}}. */
	public Job saiku(boolean refresh) throws InvalidToolRequestException {
		needSurvey();
		return context -> {
			prepareSaiku(refresh, context, true);
			return Collections.singletonMap("opened", true);
		};
	}

	private void prepareSaiku(boolean refresh, org.openforis.collect.earth.app.service.jobs.JobContext context, boolean start) throws Exception {
		JobProgress progress = new JobProgress(context);
		progress.setMessage(Messages.getString("GenerateDatabaseStarter.2"));
		saiku.setUserCancelledOperation(false);
		saiku.setRefreshDatabase(refresh);
		try {
			saiku.prepareDataForAnalysis(progress, start);
		} catch (RdbExportException e) {
			// The Saiku folder is not set, as GenerateDatabaseStarter said (CollectEarthWindow.29/40)
			throw new Exception(Messages.getString("CollectEarthWindow.29") + " " + Messages.getString("CollectEarthWindow.40")
					+ (StringUtils.isBlank(e.getMessage()) ? "" : " (" + e.getMessage() + ")"), e);
		}
	}

	/** The stand-alone Saiku tool as a ZIP at the path; the result is {@code {path}}. */
	public Job saikuTool(boolean refresh, String path) throws InvalidToolRequestException {
		needSurvey();
		if (!saikuToolAvailable) {
			throw new InvalidToolRequestException("tools.saikuTool", Messages.getString("ToolsPage.saikuTool.windowsOnly"));
		}
		if (StringUtils.isBlank(path)) {
			throw new InvalidToolRequestException("export.path", Messages.getString("DataPage.export.noPath"));
		}
		File zip = new File(path.trim());
		return context -> {
			prepareSaiku(refresh, context, false);
			context.progress(-1, Messages.getString("SaikuToolExportListener.2"));
			saiku.buildStandaloneTool(zip);
			return Collections.singletonMap("path", zip.getAbsolutePath());
		};
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

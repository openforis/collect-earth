package org.openforis.collect.earth.app.server.api;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.app.service.RestartService;
import org.openforis.collect.earth.app.service.jobs.Job;
import org.openforis.collect.earth.app.service.jobs.JobService;
import org.openforis.collect.earth.app.service.tools.AnalysisService;
import org.openforis.collect.earth.app.service.tools.IpccAnswers;
import org.openforis.collect.earth.app.service.tools.ToolsService;
import org.openforis.collect.earth.app.service.tools.ToolsService.DivideCsvRequest;
import org.openforis.collect.earth.app.service.tools.ToolsService.InvalidToolRequestException;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Tools and Utilities menus: what their dialogs ask first, the calls that are quick, and the jobs of the long
 * ones (AnalysisService, ToolsService), started here and followed through JobsController.
 */
@RestController
public class ToolsController {

	public static class RefreshRequest {
		public boolean refresh;
	}

	public static class KmlRequest {
		public String kml;
		public String csv;
	}

	public static class FilesRequest {
		public List<String> files;
	}

	public static class PathRequest {
		public String path;
	}

	private final AnalysisService analysis;
	private final ToolsService tools;
	private final JobService jobs;
	private final Runnable restart;

	@Autowired
	public ToolsController(AnalysisService analysis, ToolsService tools, JobService jobs, RestartService restart) {
		this(analysis, tools, jobs, (Runnable) restart);
	}

	ToolsController(AnalysisService analysis, ToolsService tools, JobService jobs, Runnable restart) {
		this.analysis = analysis;
		this.tools = tools;
		this.jobs = jobs;
		this.restart = restart;
	}

	@GetMapping("/api/tools/analysis")
	public Map<String, Object> analysis() {
		return analysis.analysis();
	}

	@PostMapping("/api/jobs/ipccPrepare")
	public Map<String, String> ipccPrepare(@RequestBody RefreshRequest request) {
		return start("ipcc", () -> analysis.ipccPrepare(request.refresh));
	}

	@PostMapping("/api/jobs/ipccOutputs")
	public Map<String, String> ipccOutputs(@RequestBody IpccAnswers answers) {
		return start("ipcc", () -> analysis.ipccOutputs(answers));
	}

	/** The KML's points as the plots file, then the restart (after the answer), as the Swing entry did. */
	@PostMapping("/api/tools/loadKml")
	public Map<String, Object> loadKml(@RequestBody KmlRequest request) {
		try {
			Map<String, Object> answer = new LinkedHashMap<>(tools.loadKml(request.kml, request.csv));
			restart.run();
			answer.put("restart", true);
			return answer;
		} catch (InvalidToolRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}

	@PostMapping("/api/jobs/missingPlots")
	public Map<String, String> missingPlots(@RequestBody FilesRequest request) {
		return start("missingPlots", () -> tools.missingPlots(request.files));
	}

	@GetMapping("/api/tools/divideCsv/columns")
	public Map<String, Object> divideCsvColumns() {
		return Collections.singletonMap("columns", tools.divideCsvColumns());
	}

	@PostMapping("/api/jobs/divideCsv")
	public Map<String, String> divideCsv(@RequestBody DivideCsvRequest request) {
		return start("divideCsv", () -> tools.divideCsv(request));
	}

	@PostMapping("/api/tools/deletePlots/check")
	public Map<String, Object> deletePlotsCheck(@RequestBody PathRequest request) {
		return tools.deletePlotsCheck(request.path);
	}

	@PostMapping("/api/jobs/deletePlots")
	public Map<String, String> deletePlots(@RequestBody PathRequest request) {
		return start("deletePlots", () -> tools.deletePlots(request.path));
	}

	/** A job to start, which may refuse its request */
	private interface JobMaker {
		Job make() throws InvalidToolRequestException;
	}

	/** One job of each kind at a time, as the modal dialogs allowed; a refused request is a bad request with its code. */
	private Map<String, String> start(String kind, JobMaker maker) {
		Job job;
		try {
			job = maker.make();
		} catch (InvalidToolRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
		try {
			return Collections.singletonMap("id", jobs.start(kind, job));
		} catch (IllegalStateException e) {
			throw new ApiException(HttpStatus.CONFLICT, "job.running", Messages.getString("DataPage.job.running"));
		}
	}
}

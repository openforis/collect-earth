package org.openforis.collect.earth.app.server.api;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.app.service.data.ExportRequest;
import org.openforis.collect.earth.app.service.data.ExportService;
import org.openforis.collect.earth.app.service.data.ExportService.InvalidExportException;
import org.openforis.collect.earth.app.service.data.ImportService;
import org.openforis.collect.earth.app.service.data.ImportService.ExpiredImportException;
import org.openforis.collect.earth.app.service.jobs.Job;
import org.openforis.collect.earth.app.service.jobs.JobService;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Data menu: what the export dialog offers, the file name it starts from, what the CSV update needs, and the
 * jobs of the exports and imports (ExportService, ImportService), started here and followed through JobsController.
 */
@RestController
public class DataController {

	/** The kinds of the jobs, one of each at a time (JobService) */
	static final String EXPORT = "export";
	static final String IMPORT_SUMMARY = "importSummary";
	static final String IMPORT = "import";
	static final String UPDATE_CSV = "updateCsv";

	public static class ImportSummaryRequest {
		public List<String> files;
		public boolean includeNonFinished;
	}

	public static class ImportRequest {
		public String token;
		/** The files (their paths, as the summaries named them) whose conflicting records are to be overwritten */
		public List<String> overwrite;
	}

	public static class FilesRequest {
		public List<String> files;
	}

	private final ExportService exports;
	private final ImportService imports;
	private final JobService jobs;

	@Autowired
	public DataController(ExportService exports, ImportService imports, JobService jobs) {
		this.exports = exports;
		this.imports = imports;
		this.jobs = jobs;
	}

	@GetMapping("/api/data/export/options")
	public Map<String, Object> exportOptions() {
		return exports.options();
	}

	/** The name the save dialog starts from for this request, and the extension of its format. */
	@PostMapping("/api/data/export/fileName")
	public Map<String, Object> exportFileName(@RequestBody ExportRequest request) {
		try {
			Map<String, Object> answer = new java.util.LinkedHashMap<>();
			answer.put("name", exports.fileName(request));
			answer.put("extension", request.format.getExtension());
			return answer;
		} catch (InvalidExportException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}

	@PostMapping("/api/jobs/export")
	public Map<String, String> export(@RequestBody ExportRequest request) {
		try {
			return start(EXPORT, exports.export(request));
		} catch (InvalidExportException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}

	@GetMapping("/api/data/import/csvInfo")
	public Map<String, Object> csvInfo() {
		return imports.csvInfo();
	}

	@PostMapping("/api/jobs/importSummary")
	public Map<String, String> importSummary(@RequestBody ImportSummaryRequest request) {
		return start(IMPORT_SUMMARY, imports.summaries(files(request.files), request.includeNonFinished));
	}

	@PostMapping("/api/jobs/import")
	public Map<String, String> importPrepared(@RequestBody ImportRequest request) {
		try {
			return start(IMPORT, imports.importPrepared(request.token, request.overwrite == null ? Collections.emptyList() : request.overwrite));
		} catch (ExpiredImportException e) {
			throw new ApiException(HttpStatus.CONFLICT, "import.expired", Messages.getString("DataPage.import.expired"));
		}
	}

	@PostMapping("/api/jobs/updateCsv")
	public Map<String, String> updateCsv(@RequestBody FilesRequest request) {
		return start(UPDATE_CSV, imports.updateFromCsv(files(request.files)));
	}

	private static List<String> files(List<String> files) {
		if (files == null || files.isEmpty()) {
			throw new ApiException("files.none", Messages.getString("DataPage.import.noFiles"));
		}
		return files;
	}

	/** One job of each kind at a time, as the modal dialogs allowed: a second is refused while the first runs. */
	private Map<String, String> start(String kind, Job job) {
		try {
			return Collections.singletonMap("id", jobs.start(kind, job));
		} catch (IllegalStateException e) {
			throw new ApiException(HttpStatus.CONFLICT, "job.running", Messages.getString("DataPage.job.running"));
		}
	}
}

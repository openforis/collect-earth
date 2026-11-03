package org.openforis.collect.earth.app.server.api;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.RestartService;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The projects loaded before, for the Project section of the settings page, and the loading of one of them, which
 * restarts Collect Earth as the Projects tab of the Swing dialog did (ProjectsPanel): the project's properties go
 * into earth.properties and only a new server reads them.
 */
@RestController
public class ProjectsController {

	public static class LoadRequest {
		public String folder;
	}

	public static class ImportRequest {
		public String path;
	}

	private final Logger logger = LoggerFactory.getLogger(ProjectsController.class);
	private final EarthProjectsService projects;
	private final LocalPropertiesService properties;
	private final Runnable restart;

	@Autowired
	public ProjectsController(EarthProjectsService projects, LocalPropertiesService properties, RestartService restart) {
		this(projects, properties, (Runnable) restart);
	}

	ProjectsController(EarthProjectsService projects, LocalPropertiesService properties, Runnable restart) {
		this.projects = projects;
		this.properties = properties;
		this.restart = restart;
	}

	/** The projects by name, the active one marked: its folder is the one whose checksum is stored. */
	@GetMapping("/api/projects")
	public Map<String, Object> projects() {
		String activeChecksum = properties.getValue(EarthProperty.ACTIVE_PROJECT_DEFINITION);
		List<Map<String, Object>> list = new ArrayList<>();
		for (Map.Entry<String, File> project : new TreeMap<>(projects.getProjectList()).entrySet()) {
			Map<String, Object> entry = new LinkedHashMap<>();
			entry.put("name", project.getKey());
			entry.put("folder", project.getValue().getAbsolutePath());
			entry.put("active", isActive(project.getValue(), activeChecksum));
			list.add(entry);
		}
		return Collections.singletonMap("projects", list);
	}

	private boolean isActive(File folder, String activeChecksum) {
		if (activeChecksum == null || activeChecksum.isEmpty()) {
			return false;
		}
		try {
			return activeChecksum.equals(CollectEarthUtils.getMd5FromFolder(folder));
		} catch (IOException | RuntimeException e) {
			logger.warn("The checksum of the project folder {} could not be computed", folder, e);
			return false;
		}
	}

	/**
	 * Import CEP file (the Project menu, a dropped file): the project unzipped into the projects folder and loaded, then
	 * the restart, as CollectEarthMenu did. A file that is no project is a bad request with the reason, as the dialog
	 * said it.
	 */
	@PostMapping("/api/projects/import")
	public Map<String, Object> importProject(@RequestBody ImportRequest request) {
		File file = new File(StringUtils.trimToEmpty(request == null ? null : request.path));
		if (request == null || StringUtils.isBlank(request.path) || !file.isFile() || !file.canRead()) {
			throw new ApiException("projects.import", Messages.getString("OptionWizard.51") + ": " + Messages.getString("FilesController.missing"));
		}
		try {
			projects.loadCompressedProjectFile(file);
		} catch (IOException e) {
			// A file that is not a valid project: the user is told why, it is not a fault
			logger.warn("The project file {} could not be imported : {}", file, e.getMessage());
			throw new ApiException("projects.import", Messages.getString("OptionWizard.51") + ": " + e.getMessage());
		} catch (RuntimeException e) {
			logger.error("Error importing project file {}", file, e);
			throw new ApiException("projects.import", Messages.getString("OptionWizard.51") + ": " + e.getMessage());
		}
		restart.run();
		return Collections.singletonMap("restart", true);
	}

	/**
	 * Loads one of the projects listed, then restarts. EarthProjectsService does nothing for the project that is
	 * loaded already (the same checksum), which answers restart=false instead of relaunching for nothing, as the
	 * Swing dialog did.
	 */
	@PostMapping("/api/projects/load")
	public Map<String, Object> load(@RequestBody LoadRequest request) {
		File folder = folderOf(request.folder);
		boolean loaded;
		try {
			loaded = projects.loadProjectInFolder(folder);
		} catch (IOException | RuntimeException e) {
			logger.error("The project in {} could not be loaded", folder, e);
			throw new ApiException("projects.load", Messages.getString("OptionWizard.55") + ": " + e.getMessage());
		}
		if (loaded) {
			restart.run();
		}
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("restart", loaded);
		answer.put("message", loaded ? null : Messages.getString("SettingsPage.project.alreadyActive"));
		return answer;
	}

	/** Only a folder of the list: the page sends no other, and a stray path is not a project to load. */
	private File folderOf(String path) {
		if (path != null) {
			for (File folder : projects.getProjectList().values()) {
				if (folder.getAbsolutePath().equals(new File(path).getAbsolutePath())) {
					return folder;
				}
			}
		}
		throw new ApiException("projects.unknown", Messages.getString("SettingsPage.project.unknown"));
	}
}

package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.text.MessageFormat;
import java.util.Collections;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.AssignmentInfo;
import org.openforis.collect.earth.app.service.cloud.CloudService.InvalidCloudRequestException;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.service.settings.SettingsService;
import org.openforis.collect.earth.app.service.settings.SettingsValidator;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * In a cloud project a collector works on the plot files the coordinator assigned to them, which the project file does
 * not carry (its plots file is empty for a collector). Once Collect Earth has started in a cloud project whose plots file
 * is not one of the assignments folder (the first start after a join or after the project was opened again, which
 * load the project file's own), the assigned files are asked for:
 * <ul>
 * <li>exactly one: it is downloaded and made the plots file as Apply of Settings > Project does (downloaded into the
 * assignments folder, then saved as the plots file through the settings, which reload the plots);</li>
 * <li>several: none is picked, a notice says to choose one in Settings > Project;</li>
 * <li>none: a notice says the coordinator has not given any yet;</li>
 * <li>a learning set's file in a new attempt (taking it deletes the earlier records of its plots): never taken by
 * itself, a notice says to choose it in Settings > Project, so that the deletion happens once, when the collector
 * chooses it;</li>
 * <li>the server not answering, or the file not downloaded: a notice, and the plots file stays as it was.</li>
 * </ul>
 * Once the plots file is one of the assignments folder nothing is asked again. A coordinator ({@code admin}) is left
 * alone: the project's plots are theirs.
 */
@Component
public class AssignedPlotFileSetup {

	/** The notices' kind */
	public static final String NOTICE = "cloudPlotFile"; //$NON-NLS-1$

	/** What was done */
	public enum Outcome {
		/** Not a cloud project, a coordinator's, or the plots file is an assigned one already */
		NOT_NEEDED,
		/** The only file assigned is the plots file now */
		APPLIED,
		/** Several files: the collector chooses */
		SEVERAL,
		/** The only file is a learning set's in a new attempt: the collector chooses it */
		LEARNING_SET,
		/** No file assigned yet */
		NONE,
		/** The server could not be asked, the file not downloaded or not saved as the plots file */
		FAILED
	}

	/** Makes a file of the assignments folder the plots file, as the settings page's Apply does */
	interface PlotFileSaver {
		void save(String path) throws Exception; // NOSONAR the settings' refusal and anything else are said alike
	}

	private static final String COORDINATOR_ROLE = "admin"; //$NON-NLS-1$

	private final Logger logger = LoggerFactory.getLogger(AssignedPlotFileSetup.class);
	private final CloudService cloud;
	private final LocalPropertiesService properties;
	private final PlotFileSaver saver;
	private final NoticeService notices;

	@Autowired
	public AssignedPlotFileSetup(CloudService cloud, LocalPropertiesService properties, SettingsService settings,
			@Autowired(required = false) NoticeService notices) {
		this(cloud, properties, path -> settings.save(Collections.singletonMap(EarthProperty.SAMPLE_FILE.toString(), path)), notices);
	}

	AssignedPlotFileSetup(CloudService cloud, LocalPropertiesService properties, PlotFileSaver saver, NoticeService notices) {
		this.cloud = cloud;
		this.properties = properties;
		this.saver = saver;
		this.notices = notices;
	}

	/** Whether the open project is a cloud project whose plots file is not one of the files assigned to the operator */
	boolean isNeeded() {
		if (!properties.isCloudSyncEnabled()) {
			return false;
		}
		CloudBinding binding = properties.getCloudBinding();
		if (binding != null && COORDINATOR_ROLE.equals(binding.role)) {
			return false;
		}
		String plotFile = StringUtils.trimToEmpty(properties.getValue(EarthProperty.SAMPLE_FILE));
		return !SettingsValidator.isInside(plotFile, cloud.assignmentsFolder());
	}

	/** Run once the plots of the start are loaded; never throws. */
	public Outcome run() {
		try {
			if (!isNeeded()) {
				return Outcome.NOT_NEEDED;
			}
			return setUp();
		} catch (RuntimeException e) {
			logger.error("Could not set up the assigned plot file", e); //$NON-NLS-1$
			post(Notice.WARNING, Messages.getString("CloudPlotFile.failed")); //$NON-NLS-1$
			return Outcome.FAILED;
		}
	}

	private Outcome setUp() {
		List<AssignmentInfo> files;
		try {
			files = cloud.assignedPlotFiles();
		} catch (InvalidCloudRequestException e) {
			post(Notice.WARNING, Messages.getString("CloudPlotFile.failed")); //$NON-NLS-1$
			return Outcome.FAILED;
		}
		if (files.isEmpty()) {
			post(Notice.INFO, Messages.getString("CloudPlotFile.none")); //$NON-NLS-1$
			return Outcome.NONE;
		}
		if (files.size() > 1) {
			post(Notice.INFO, MessageFormat.format(Messages.getString("CloudPlotFile.several"), files.size())); //$NON-NLS-1$
			return Outcome.SEVERAL;
		}
		AssignmentInfo only = files.get(0);
		String name = StringUtils.defaultIfBlank(only.getFilename(), only.getCsvFileId());
		if (only.getFreshSince() != null) {
			post(Notice.INFO, MessageFormat.format(Messages.getString("CloudPlotFile.learningSet"), name)); //$NON-NLS-1$
			return Outcome.LEARNING_SET;
		}
		File file;
		try {
			file = cloud.downloadAssignment(only);
			saver.save(file.getAbsolutePath());
		} catch (Exception e) { // NOSONAR the download's and the settings' refusals alike
			logger.warn("Could not make the assigned plot file {} the plots file: {}", name, e.getMessage()); //$NON-NLS-1$
			post(Notice.WARNING, Messages.getString("CloudPlotFile.failed")); //$NON-NLS-1$
			return Outcome.FAILED;
		}
		logger.info("The assigned plot file {} is the plots file now", file.getName()); //$NON-NLS-1$
		post(Notice.INFO, MessageFormat.format(Messages.getString("CloudPlotFile.applied"), name, only.getPlotCount())); //$NON-NLS-1$
		return Outcome.APPLIED;
	}

	private void post(String severity, String message) {
		if (notices != null) {
			notices.post(new Notice(NOTICE, severity, Messages.getString("CloudPlotFile.title"), message)); //$NON-NLS-1$
		}
	}
}

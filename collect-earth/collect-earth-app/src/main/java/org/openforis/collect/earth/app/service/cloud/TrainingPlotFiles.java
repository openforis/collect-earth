package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.AssignmentInfo;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.MyAssignment;
import org.openforis.collect.earth.app.service.cloud.CloudService.InvalidCloudRequestException;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.service.settings.SettingsValidator;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Training the team (docs/plans/2026-11-17-training-the-team.md): the coordinator gives everyone the same training
 * plots for the first days, then finishes the training, which keeps the scores and deletes the answers. Collect Earth
 * follows it by itself, at its start and every five minutes while it runs (the cloud sync's cycle), in a cloud project
 * whose plots come from the server (MyPlotsService):
 * <ul>
 * <li>a training that is over (finished, or its set deleted): this computer's records of its plots are deleted (they
 * are no plots of the project, and the server throws away any sent late), and the training files of the assignments
 * folder that are no running set's go. The training set open, if it was one of them, gives way to the person's plots,
 * and a notice says so;</li>
 * <li>a training set the person takes part in is offered, or opened by itself while they hold no plot of their own
 * (CloudService.offerTraining): a running Collect Earth gets a training started on the dashboard within minutes.</li>
 * </ul>
 * Without the server nothing happens (the next check tries again). An older server, which has no person's plots, is left
 * to the files of before (AssignedPlotFileSetup).
 */
@Component
public class TrainingPlotFiles {

	/** How often a running Collect Earth asks, as for the person's plots (the sync's cycle calls it more often) */
	static final long CHECK_INTERVAL_MS = MyPlotsService.CHECK_MINUTES * 60 * 1000L;
	/**
	 * How the server names a training set's file (routes/training.ts servedName): a file of the assignments folder so
	 * named that is no running set's is the file of a training that is over
	 */
	static final List<String> TRAINING_PREFIXES = Collections.unmodifiableList(Arrays.asList("Learning – ", "Calibration – ")); //$NON-NLS-1$ //$NON-NLS-2$

	/** What a check did */
	public enum Outcome {
		/** Not a cloud project with the person's plots from the server */
		NOT_NEEDED,
		/** The server could not be asked: tried again at the next check */
		FAILED,
		/** Nothing to clean up (a training may have been offered or opened) */
		NOTHING,
		/** The training set open was over: the person's plots are the plots file again */
		BACK_TO_MY_PLOTS
	}

	private final Logger logger = LoggerFactory.getLogger(TrainingPlotFiles.class);
	private final CloudService cloud;
	private final LocalPropertiesService properties;
	private final NoticeService notices;
	private volatile long lastCheck = Long.MIN_VALUE;

	@Autowired
	public TrainingPlotFiles(CloudService cloud, LocalPropertiesService properties, @Autowired(required = false) NoticeService notices) {
		this.cloud = cloud;
		this.properties = properties;
		this.notices = notices;
	}

	/** Checks unless the last check is less than CHECK_INTERVAL_MS old; called by every sync cycle. */
	void checkIfDue(long now) {
		if (lastCheck != Long.MIN_VALUE && now - lastCheck < CHECK_INTERVAL_MS) {
			return;
		}
		lastCheck = now;
		check();
	}

	/** At the start, once the person's plots are checked; never throws. */
	public Outcome run() {
		lastCheck = System.currentTimeMillis();
		return check();
	}

	synchronized Outcome check() {
		try {
			if (!properties.isCloudSyncEnabled() || StringUtils.isBlank(properties.getCloudSyncToken()) || !cloud.hasPersonsPlots()) {
				return Outcome.NOT_NEEDED;
			}
			MyAssignment mine;
			try {
				mine = cloud.myAssignment();
			} catch (InvalidCloudRequestException e) {
				return Outcome.FAILED; // offline, or the server is away: the next check
			}
			deleteRecordsOfTheTrainingOver(mine.getFinishedPlots());
			File folder = cloud.assignmentsFolder();
			Set<String> running = new LinkedHashSet<>();
			for (AssignmentInfo info : mine.getAssignments()) {
				if (info.getTrainingKind() != null) {
					running.add(localName(folder, info.getFilename()));
				}
			}
			Set<String> finished = new LinkedHashSet<>();
			for (String name : mine.getFinishedFiles()) {
				finished.add(localName(folder, name));
			}
			Outcome outcome = Outcome.NOTHING;
			File open = cloud.openTrainingFile();
			if (open != null && isTrainingOver(open, folder, running, finished)) {
				if (cloud.leaveTraining()) {
					outcome = Outcome.BACK_TO_MY_PLOTS;
					logger.info("The training set {} is over: back to the person's plots", open.getName()); //$NON-NLS-1$
					post(Messages.getString("CloudTraining.over")); //$NON-NLS-1$
				} else {
					emptied(open); // no copy of the person's plots yet: no plot of the training left to work on
				}
			}
			deleteFilesOfTheTrainingOver(folder, running, finished);
			if (outcome == Outcome.NOTHING) {
				cloud.offerTraining(mine.getAssignments());
			}
			return outcome;
		} catch (RuntimeException e) {
			logger.error("Could not follow the training", e); //$NON-NLS-1$
			return Outcome.FAILED;
		}
	}

	/**
	 * Whether a file is a training's of the assignments folder, of a set not running (finished or deleted): one the
	 * server listed as finished, or named as the server names training files
	 */
	static boolean isTrainingOver(File file, File folder, Set<String> running, Collection<String> finished) {
		if (!SettingsValidator.isInside(file.getPath(), folder)) {
			return false;
		}
		String name = file.getName();
		return !running.contains(name) && (finished.contains(name) || isTrainingName(folder, name));
	}

	private static boolean isTrainingName(File folder, String name) {
		for (String prefix : TRAINING_PREFIXES) {
			if (name.startsWith(prefix) || name.startsWith(localName(folder, prefix))) {
				return true;
			}
		}
		return false;
	}

	/** The files of the training over, from the assignments folder, but the plots file in use (left without plots) */
	private void deleteFilesOfTheTrainingOver(File folder, Set<String> running, Set<String> finished) {
		File[] files = folder.listFiles(File::isFile);
		if (files == null) {
			return;
		}
		String inUse = StringUtils.trimToEmpty(properties.getValue(EarthProperty.SAMPLE_FILE));
		for (File file : files) {
			if (!isTrainingOver(file, folder, running, finished) || (!inUse.isEmpty() && new File(inUse).getAbsoluteFile().equals(file.getAbsoluteFile()))) {
				continue;
			}
			try {
				Files.delete(file.toPath());
				logger.info("The file of a training that is over was deleted: {}", file.getName()); //$NON-NLS-1$
			} catch (IOException e) {
				logger.warn("Could not delete the file of a training that is over {}: {}", file.getName(), e.getMessage()); //$NON-NLS-1$
			}
		}
	}

	/**
	 * This computer's records of the plots of the training over: deleted once for the same plots (a new training over
	 * deletes again, its plots among them)
	 */
	private void deleteRecordsOfTheTrainingOver(List<String> plots) {
		if (plots.isEmpty()) {
			return;
		}
		String done = DigestUtils.sha256Hex(properties.getCloudProjectId() + '|' + String.join("\n", new TreeSet<>(plots))); //$NON-NLS-1$
		if (done.equals(properties.getValue(EarthProperty.CLOUD_TRAINING_CLEANED))) {
			return;
		}
		int deleted = cloud.deleteTrainingRecords(plots);
		if (deleted < 0) {
			return; // no survey loaded yet: the next check
		}
		logger.info("The training is over: {} records of its {} plots deleted", deleted, plots.size()); //$NON-NLS-1$
		properties.setValue(EarthProperty.CLOUD_TRAINING_CLEANED, done);
	}

	/** The file left with its header row only: the plots map shows no plot of it (it reads the file again once changed) */
	private void emptied(File file) {
		try {
			List<String> lines = Files.readAllLines(file.toPath(), StandardCharsets.UTF_8);
			if (lines.size() > 1) {
				Files.write(file.toPath(), (lines.get(0) + System.lineSeparator()).getBytes(StandardCharsets.UTF_8));
			}
		} catch (IOException e) {
			logger.warn("Could not take the plots out of the training file {}: {}", file.getName(), e.getMessage()); //$NON-NLS-1$
		}
	}

	private void post(String message) {
		if (notices != null) {
			notices.post(new Notice(MyPlotsService.NOTICE, Notice.INFO, Messages.getString("MyPlots.title"), message)); //$NON-NLS-1$
		}
	}

	/** A name as the client writes it into the assignments folder (CloudApiClient.downloadAssignedCsv) */
	private static String localName(File folder, String filename) {
		return CloudApiClient.fileNameHere(folder, new File(StringUtils.defaultString(filename)).getName());
	}

	/**
	 * The name of the training set the person opened, its extension left out, for the plots list to say the plots are
	 * the training's; null when the plots file is not a training set's
	 */
	public static String trainingName(String plotsFile, String trainingFile) {
		if (StringUtils.isBlank(plotsFile) || StringUtils.isBlank(trainingFile)
				|| !new File(plotsFile.trim()).getAbsoluteFile().equals(new File(trainingFile.trim()).getAbsoluteFile())) {
			return null;
		}
		String name = new File(trainingFile.trim()).getName();
		return name.toLowerCase(java.util.Locale.ROOT).endsWith(".csv") ? name.substring(0, name.length() - 4) : name; //$NON-NLS-1$
	}
}

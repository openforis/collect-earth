package org.openforis.collect.earth.app.service;

import static org.openforis.collect.earth.app.EarthConstants.EARTH_SURVEY_NAME;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.text.MessageFormat;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.SurveyRevision;
import org.openforis.collect.earth.app.service.cloud.SurveyUpdateBackup;
import org.openforis.collect.earth.app.service.cloud.SurveyUpdateService;
import org.openforis.collect.io.exception.CodeListImportException;
import org.openforis.collect.manager.exception.SurveyValidationException;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.ModelVersion;
import org.openforis.idm.metamodel.xml.IdmlParseException;
import org.openforis.idm.metamodel.xml.XmlParseException;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class EarthSurveyService extends AbstractEarthSurveyService implements InitializingBean{

	@Autowired
	private NoticeService notices;

	/** Applies the settings of the project of before again, when its survey is put back; absent in some tests */
	@Autowired(required = false)
	private EarthProjectsService projects;

	private volatile String loadedSurveyRevision;

	/** How long a changed survey that failed for another reason than itself is waited for before it is tried again */
	long retryWaitMs = 2000;

	/** A survey with several versions and none chosen: the most recent is used, and the settings let the user change it. */
	@Override
	protected void versionChosenByDefault(CollectSurvey survey, ModelVersion chosen) {
		notices.post(new Notice("survey", Notice.INFO, Messages.getString("SettingsPage.surveyVersion"), //$NON-NLS-1$ //$NON-NLS-2$
				MessageFormat.format(Messages.getString("SettingsPage.surveyVersion.notice"), chosen.getName()))); //$NON-NLS-1$
	}

	/**
	 * Loads the survey of the project open, as before, unless the project was just opened again from its cloud project
	 * (a changed survey taken: SurveyUpdateBackup): a survey Collect cannot import or validate then puts the files of
	 * before back, loads the survey of before, and tells the person, rather than leaving Collect Earth unable to start,
	 * and the changed survey is not offered again. Any other failure (the database busy at that start, the survey file
	 * held by an antivirus on Windows) is tried once more after a moment; failing again, the files of before are put back
	 * too, but the change is offered again.
	 */
	@Override
	public void afterPropertiesSet() throws Exception {
		// This is only done if the survey has not yet been created in the DB
		if (getCollectSurvey() != null) {
			return;
		}
		File idmSurveyModel = new File(getIdmFilePath());
		File projectFolder = idmSurveyModel.getAbsoluteFile().getParentFile();
		if (projectFolder == null || !SurveyUpdateBackup.isPending(projectFolder)) {
			loadSurvey(idmSurveyModel);
			return;
		}
		try {
			if (!idmSurveyModel.exists()) {
				throw new FileNotFoundException("The survey definition file could not be found in " + idmSurveyModel.getAbsolutePath()); //$NON-NLS-1$
			}
			readChangedSurvey(idmSurveyModel);
			SurveyUpdateBackup.discard(projectFolder);
		} catch (Exception e) {
			boolean surveyError = isSurveyError(e);
			logger.error(surveyError ? "The survey of the project opened again cannot be used: the one before is put back" //$NON-NLS-1$
					: "The survey of the project opened again could not be loaded at this start: the one before is put back, and it is offered again", e); //$NON-NLS-1$
			restoreSurveyBefore(projectFolder, e, surveyError);
		}
	}

	/** {@link #readSurvey} of the changed survey, tried once more after a moment when it fails for another reason than itself */
	private void readChangedSurvey(File idmSurveyModel) throws Exception {
		try {
			readSurvey(idmSurveyModel);
		} catch (Exception e) {
			if (isSurveyError(e)) {
				throw e;
			}
			logger.warn("The changed survey could not be loaded ({}): tried again", e.getMessage()); //$NON-NLS-1$
			try {
				Thread.sleep(retryWaitMs);
			} catch (InterruptedException interrupted) {
				Thread.currentThread().interrupt();
				throw e;
			}
			readSurvey(idmSurveyModel);
		}
	}

	/**
	 * Whether a failure to load a survey is the survey's own (Collect 4.0's SurveyManager: a survey that does not validate,
	 * an IDML it cannot parse, its code lists that cannot be imported, wrapped in a SurveyImportException), as opposed to
	 * one of this computer at that moment (the database, the file system), after which the same survey may load.
	 */
	static boolean isSurveyError(Throwable failure) {
		int depth = 0;
		for (Throwable t = failure; t != null && depth < 20; t = t.getCause() == t ? null : t.getCause(), depth++) {
			if (t instanceof SurveyValidationException || t instanceof IdmlParseException || t instanceof XmlParseException
					|| t instanceof CodeListImportException) {
				return true;
			}
		}
		return false;
	}

	/** The survey loaded as before: one that does not validate is logged, and none is loaded */
	private void loadSurvey(File idmSurveyModel) throws Exception {
		if (!idmSurveyModel.exists()) {
			logger.error("The survey definition file could not be found in " + idmSurveyModel.getAbsolutePath()); //$NON-NLS-1$
			return;
		}
		try {
			readSurvey(idmSurveyModel);
		} catch (final SurveyValidationException e) {
			logger.error("Unable to validate survey at " + getIdmFilePath(), e); //$NON-NLS-1$
		}
	}

	/** Initializes the Collect survey from the idm: imported when it is not in the database yet, else updated in place */
	private void readSurvey(File idmSurveyModel) throws Exception {
		CollectSurvey survey;
		try (FileInputStream fis = new FileInputStream(idmSurveyModel)) {
			survey = surveyManager.unmarshalSurvey(fis, true, true);
		}
		if (survey != null && surveyManager.getByUri(survey.getUri()) == null) { // NOT IN THE DB
			String surveyName = EARTH_SURVEY_NAME + localPropertiesService.getValue(EarthProperty.SURVEY_NAME);
			survey = surveyManager.importModel(idmSurveyModel, surveyName, false, true);
		} else { // UPDATE ALREADY EXISTANT MODEL
			survey = surveyManager.updateModel(idmSurveyModel, false, true);
		}
		checkVersions(survey);
		setCollectSurvey(survey);
		loadedSurveyRevision = SurveyRevision.ofFile(idmSurveyModel);
	}

	/**
	 * The words of a failure for the person: the first message of its causes that says more than the name of the next
	 * (Collect wraps its errors as SurveyImportException(cause), whose message is the cause's name only), else the name
	 * of the last.
	 */
	static String reasonOf(Throwable failure) {
		Throwable last = failure;
		int depth = 0;
		for (Throwable t = failure; t != null && depth < 20; t = t.getCause() == t ? null : t.getCause(), depth++) {
			String message = StringUtils.trimToNull(t.getMessage());
			if (message != null && (t.getCause() == null || !message.equals(t.getCause().toString()))) {
				return message;
			}
			last = t;
		}
		return last.getClass().getSimpleName();
	}

	/**
	 * The files of before put back, their settings applied again (the plots file, and the training set or the plots to correct open, kept), the
	 * survey of before loaded, and the person told. A survey Collect cannot use ({@code refuse}) is not offered again
	 * until the coordinator changes it again; another failure leaves it offered again.
	 */
	private void restoreSurveyBefore(File projectFolder, Exception cause, boolean refuse) throws Exception {
		SurveyUpdateBackup.Restored restored = SurveyUpdateBackup.restore(projectFolder);
		if (projects != null) {
			String plotFile = localPropertiesService.getValue(EarthProperty.SAMPLE_FILE);
			String training = localPropertiesService.getValue(EarthProperty.CLOUD_TRAINING_FILE);
			String corrections = localPropertiesService.getValue(EarthProperty.CLOUD_CORRECTIONS_FILE);
			try {
				projects.loadProjectInFolder(projectFolder);
			} catch (IOException | RuntimeException e) {
				logger.error("The settings of the project of before could not be applied again", e); //$NON-NLS-1$
			}
			localPropertiesService.setValue(EarthProperty.SAMPLE_FILE, plotFile);
			localPropertiesService.setValue(EarthProperty.CLOUD_TRAINING_FILE, training);
			localPropertiesService.setValue(EarthProperty.CLOUD_CORRECTIONS_FILE, corrections);
		}
		File idmSurveyModel = new File(getIdmFilePath());
		loadSurvey(idmSurveyModel);
		String before = restored != null && restored.revisionBefore != null ? restored.revisionBefore : SurveyRevision.ofFile(idmSurveyModel);
		String refused = restored == null ? null : restored.revisionAfter;
		localPropertiesService.updateCloudBinding(projectFolder, binding -> {
			binding.surveyRevision = before;
			if (refuse) {
				binding.surveyRevisionRefused = refused;
			}
		});
		if (notices != null) {
			String reason = reasonOf(cause);
			notices.post(new Notice(SurveyUpdateService.RESULT_NOTICE, Notice.WARNING, Messages.getString("CloudSurvey.changed.title"), //$NON-NLS-1$
					MessageFormat.format(Messages.getString(refuse ? "CloudSurvey.notUsable" : "CloudSurvey.notLoaded"), StringUtils.abbreviate(reason, 300)))); //$NON-NLS-1$ //$NON-NLS-2$
		}
	}

	/**
	 * The revision of the survey loaded (SurveyRevision, the cloud's name for it), sent with the records made with it; null
	 * before one is loaded.
	 */
	public String getLoadedSurveyRevision() {
		return loadedSurveyRevision;
	}

	/**
	 * The name of a survey as the user knows it, for the titles of the pages and of Google Earth Web's tab: in the UI
	 * language if the survey has it in that language, else in its default one, else the survey's description. Null when
	 * there is no survey.
	 *
	 * @param language the UI language, as a two-letter code
	 */
	public static String projectName(CollectSurvey survey, String language) {
		if (survey == null) {
			return null;
		}
		if (StringUtils.isNotBlank(survey.getProjectName(language))) {
			return survey.getProjectName(language);
		} else if (StringUtils.isNotBlank(survey.getProjectName())) {
			return survey.getProjectName();
		}
		return survey.getDescription(language);
	}
}

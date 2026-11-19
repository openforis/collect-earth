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
import org.openforis.collect.manager.exception.SurveyValidationException;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.ModelVersion;
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

	/** A survey with several versions and none chosen: the most recent is used, and the settings let the user change it. */
	@Override
	protected void versionChosenByDefault(CollectSurvey survey, ModelVersion chosen) {
		notices.post(new Notice("survey", Notice.INFO, Messages.getString("SettingsPage.surveyVersion"), //$NON-NLS-1$ //$NON-NLS-2$
				MessageFormat.format(Messages.getString("SettingsPage.surveyVersion.notice"), chosen.getName()))); //$NON-NLS-1$
	}

	/**
	 * Loads the survey of the project open, as before, unless the project was just opened again from its cloud project
	 * (a changed survey taken: SurveyUpdateBackup): a survey Collect cannot import or validate then puts the files of
	 * before back, loads the survey of before, and tells the person, rather than leaving Collect Earth unable to start.
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
			readSurvey(idmSurveyModel);
			SurveyUpdateBackup.discard(projectFolder);
		} catch (Exception e) {
			logger.error("The survey of the project opened again could not be used: the one before is put back", e); //$NON-NLS-1$
			restoreSurveyBefore(projectFolder, e);
		}
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
	 * The files of before put back, their settings applied again (the plots file and the training set open kept), the
	 * survey of before loaded, the changed one not offered again until the coordinator changes it again, and the person
	 * told.
	 */
	private void restoreSurveyBefore(File projectFolder, Exception cause) throws Exception {
		SurveyUpdateBackup.Restored restored = SurveyUpdateBackup.restore(projectFolder);
		if (projects != null) {
			String plotFile = localPropertiesService.getValue(EarthProperty.SAMPLE_FILE);
			String training = localPropertiesService.getValue(EarthProperty.CLOUD_TRAINING_FILE);
			try {
				projects.loadProjectInFolder(projectFolder);
			} catch (IOException | RuntimeException e) {
				logger.error("The settings of the project of before could not be applied again", e); //$NON-NLS-1$
			}
			localPropertiesService.setValue(EarthProperty.SAMPLE_FILE, plotFile);
			localPropertiesService.setValue(EarthProperty.CLOUD_TRAINING_FILE, training);
		}
		File idmSurveyModel = new File(getIdmFilePath());
		loadSurvey(idmSurveyModel);
		String before = restored != null && restored.revisionBefore != null ? restored.revisionBefore : SurveyRevision.ofFile(idmSurveyModel);
		String refused = restored == null ? null : restored.revisionAfter;
		localPropertiesService.updateCloudBinding(projectFolder, binding -> {
			binding.surveyRevision = before;
			binding.surveyRevisionRefused = refused;
		});
		if (notices != null) {
			String reason = StringUtils.defaultIfBlank(cause.getMessage(), cause.getClass().getSimpleName());
			notices.post(new Notice(SurveyUpdateService.RESULT_NOTICE, Notice.WARNING, Messages.getString("CloudSurvey.changed.title"), //$NON-NLS-1$
					MessageFormat.format(Messages.getString("CloudSurvey.notUsable"), StringUtils.abbreviate(reason, 300)))); //$NON-NLS-1$
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

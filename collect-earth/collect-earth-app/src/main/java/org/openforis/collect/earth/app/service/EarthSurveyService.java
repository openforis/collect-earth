package org.openforis.collect.earth.app.service;

import static org.openforis.collect.earth.app.EarthConstants.EARTH_SURVEY_NAME;

import java.io.File;
import java.io.FileInputStream;
import java.text.MessageFormat;

import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
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

	/** A survey with several versions and none chosen: the most recent is used, and the settings let the user change it. */
	@Override
	protected void versionChosenByDefault(CollectSurvey survey, ModelVersion chosen) {
		notices.post(new Notice("survey", Notice.INFO, Messages.getString("SettingsPage.surveyVersion"), //$NON-NLS-1$ //$NON-NLS-2$
				MessageFormat.format(Messages.getString("SettingsPage.surveyVersion.notice"), chosen.getName()))); //$NON-NLS-1$
	}

	@Override
    public void afterPropertiesSet() throws Exception {
		// Initialize the Collect survey using the idm
		// This is only done if the survey has not yet been created in the DB

		if (getCollectSurvey() == null) {
			CollectSurvey survey;
			try {
				File idmSurveyModel = new File(getIdmFilePath());
				if (idmSurveyModel.exists()) {
					try (FileInputStream fis = new FileInputStream(idmSurveyModel)) {
						survey = surveyManager.unmarshalSurvey(fis, true, true);
					}
					if (survey != null && surveyManager.getByUri(survey.getUri()) == null) { // NOT
																			// IN
						// THE DB
						String surveyName = EARTH_SURVEY_NAME
								+ localPropertiesService.getValue(EarthProperty.SURVEY_NAME);
						survey = surveyManager.importModel(idmSurveyModel, surveyName, false, true);

					} else { // UPDATE ALREADY EXISTANT MODEL
						survey = surveyManager.updateModel(idmSurveyModel, false, true);
					}

					checkVersions(survey);

					setCollectSurvey(survey);
				} else {
					logger.error(
							"The survey definition file could not be found in " + idmSurveyModel.getAbsolutePath()); //$NON-NLS-1$
				}
			} catch (final SurveyValidationException e) {
				logger.error("Unable to validate survey at " + getIdmFilePath(), e); //$NON-NLS-1$
			}
		}

	}
}

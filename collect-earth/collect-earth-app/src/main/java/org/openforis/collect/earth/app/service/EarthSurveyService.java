package org.openforis.collect.earth.app.service;

import static org.openforis.collect.earth.app.EarthConstants.EARTH_SURVEY_NAME;

import java.io.File;
import java.io.FileInputStream;

import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.manager.exception.SurveyValidationException;
import org.openforis.collect.model.CollectSurvey;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;

@Component
public class EarthSurveyService extends AbstractEarthSurveyService implements InitializingBean{

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

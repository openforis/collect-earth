package org.openforis.collect.earth.app.service;

import static org.openforis.collect.earth.app.EarthConstants.EARTH_SURVEY_NAME;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;

import javax.annotation.PostConstruct;

import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.manager.exception.SurveyValidationException;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.persistence.SurveyImportException;
import org.openforis.idm.metamodel.xml.IdmlParseException;
import org.springframework.stereotype.Component;

@Component
public class EarthSurveyService extends AbstractEarthSurveyService {

	@PostConstruct
	private void init() throws FileNotFoundException, IdmlParseException, SurveyImportException {
		// Initialize the Collect survey using the idm
		// This is only done if the survey has not yet been created in the DB

		if (getCollectSurvey() == null) {
			CollectSurvey survey;
			try {
				File idmSurveyModel = new File(getIdmFilePath());
				if (idmSurveyModel.exists()) {
					survey = surveyManager.unmarshalSurvey(new FileInputStream(idmSurveyModel), true, true);
					if (surveyManager.getByUri(survey.getUri()) == null) { // NOT
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
				e.printStackTrace();
			}
		}

	}
}

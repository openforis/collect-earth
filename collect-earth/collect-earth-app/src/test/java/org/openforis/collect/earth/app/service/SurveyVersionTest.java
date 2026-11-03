package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.ModelVersion;

/**
 * The version of the survey the records are created with, which a Swing dialog asked for on every start of a survey
 * with several versions: kept when set, else the most recent, said to the user so they can choose another in the
 * settings.
 */
public class SurveyVersionTest {

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final List<String> chosenByDefault = new ArrayList<>();
	private final AbstractEarthSurveyService service = new AbstractEarthSurveyService() {
		@Override
		protected void versionChosenByDefault(CollectSurvey survey, ModelVersion chosen) {
			chosenByDefault.add(chosen.getName());
		}
	};

	{
		service.localPropertiesService = properties;
	}

	private static CollectSurvey survey(String... names) {
		CollectSurvey survey = mock(CollectSurvey.class);
		List<ModelVersion> versions = new ArrayList<>();
		for (String name : names) {
			ModelVersion version = mock(ModelVersion.class);
			when(version.getName()).thenReturn(name);
			versions.add(version);
		}
		when(survey.getVersions()).thenReturn(versions);
		return survey;
	}

	@Test
	public void theVersionChosenBeforeIsKept() {
		when(properties.getModelVersionName()).thenReturn("v2025");
		service.checkVersions(survey("v2024", "v2025", "v2026"));
		verify(properties, never()).setModelVersionName(anyString());
		assertTrue(chosenByDefault.isEmpty());
	}

	@Test
	public void withNoneChosenTheMostRecentIsUsedAndTheUserTold() {
		when(properties.getModelVersionName()).thenReturn(null);
		service.checkVersions(survey("v2024", "v2025", "v2026"));
		verify(properties).setModelVersionName("v2026");
		assertEquals(Arrays.asList("v2026"), chosenByDefault);
	}

	@Test
	public void aVersionTheSurveyNoLongerHasIsReplacedByTheMostRecent() {
		when(properties.getModelVersionName()).thenReturn("v2019");
		service.checkVersions(survey("v2024", "v2025"));
		verify(properties).setModelVersionName("v2025");
		assertEquals(Arrays.asList("v2025"), chosenByDefault);
	}

	@Test
	public void aSurveyWithOneVersionUsesItWithoutAWord() {
		service.checkVersions(survey("only"));
		verify(properties).setModelVersionName("only");
		assertTrue(chosenByDefault.isEmpty());
		service.checkVersions(survey());
		verify(properties, never()).setModelVersionName("");
	}
}

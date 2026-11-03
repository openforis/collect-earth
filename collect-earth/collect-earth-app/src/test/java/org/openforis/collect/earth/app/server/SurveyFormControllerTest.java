package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.InputStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * The web form asks for the form of the survey for every plot: it does not depend on the plot, so the browser revalidates
 * it, and gets a 304 with nothing in it while the survey, the language and the model version are the same.
 */
public class SurveyFormControllerTest {

	private final SurveyFormController controller = new SurveyFormController();
	private final EarthSurveyService earthSurveyService = mock(EarthSurveyService.class);
	private final LocalPropertiesService localPropertiesService = mock(LocalPropertiesService.class);

	@BeforeEach
	public void wire() throws Exception {
		CollectSurvey survey;
		try (InputStream is = getClass().getResourceAsStream("/test_survey.idm.xml")) {
			survey = (CollectSurvey) new CollectSurveyIdmlBinder(new CollectSurveyContext()).unmarshal(is, true);
		}
		when(earthSurveyService.getCollectSurvey()).thenReturn(survey);
		when(localPropertiesService.getUiLanguage()).thenReturn(UI_LANGUAGE.EN);
		ReflectionTestUtils.setField(controller, "earthSurveyService", earthSurveyService);
		ReflectionTestUtils.setField(controller, "localPropertiesService", localPropertiesService);
	}

	private MockHttpServletResponse get(String ifNoneMatch) throws Exception {
		MockHttpServletRequest request = new MockHttpServletRequest();
		if (ifNoneMatch != null) {
			request.addHeader("If-None-Match", ifNoneMatch);
		}
		MockHttpServletResponse response = new MockHttpServletResponse();
		controller.surveyForm(request, response);
		return response;
	}

	@Test
	public void theFormIsRevalidatedAndAnswered304WhileUnchanged() throws Exception {
		MockHttpServletResponse first = get(null);
		assertEquals(200, first.getStatus());
		assertEquals("no-cache", first.getHeader("Cache-Control"));
		assertTrue(first.getContentType().startsWith("application/json"));
		assertTrue(first.getContentAsString().contains("\"tabs\""));
		String etag = first.getHeader("ETag");
		assertNotNull(etag);

		MockHttpServletResponse second = get(etag);
		assertEquals(304, second.getStatus());
		assertEquals(0, second.getContentAsByteArray().length);
	}

	@Test
	public void anotherLanguageIsAnotherForm() throws Exception {
		String english = get(null).getHeader("ETag");
		when(localPropertiesService.getUiLanguage()).thenReturn(UI_LANGUAGE.ES);

		MockHttpServletResponse spanish = get(english);
		assertEquals(200, spanish.getStatus());
		assertNotEquals(english, spanish.getHeader("ETag"));
	}
}

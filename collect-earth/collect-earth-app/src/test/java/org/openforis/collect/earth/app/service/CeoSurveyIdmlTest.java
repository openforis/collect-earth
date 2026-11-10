package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;
import org.openforis.collect.manager.validation.SurveyValidator;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.expression.ExpressionValidator;
import org.openforis.idm.metamodel.expression.ExpressionValidator.ExpressionValidationResult;
import org.openforis.idm.metamodel.validation.Check;
import org.openforis.idm.metamodel.validation.CustomCheck;

/**
 * The surveys the cloud's import of Collect Earth Online projects writes (collect-earth-cloud/src/ceo/idml.ts, plan
 * docs/plans/2026-11-09-ceo-bridge.md, B6), read by Collect's own parser, checked by Collect's survey validator (the
 * Survey Designer's rules for names, relevance and check expressions) and turned into the web form, as Collect Earth does when
 * it opens the project. The surveys are those of test/fixtures/ceo, written by the cloud's tests into
 * src/test/resources/ceo; {@code -Dceo.idml.dir=<folder>} reads every *.idm.xml of another folder instead.
 */
public class CeoSurveyIdmlTest {

	@Test
	@SuppressWarnings("unchecked")
	public void theImportedSurveysOpenInCollectEarth() throws Exception {
		List<File> files = surveyFiles();
		assertFalse(files.isEmpty(), "no survey to read");
		List<String> problems = new ArrayList<>();
		for (File file : files) {
			CollectSurvey survey;
			try (InputStream is = new FileInputStream(file)) {
				survey = (CollectSurvey) new CollectSurveyIdmlBinder(new CollectSurveyContext()).unmarshal(is, true);
			} catch (Exception e) {
				problems.add(file.getName() + ": not read: " + e.getMessage());
				continue;
			}
			// Collect's own checks of the Survey Designer: node names, and every relevance, check and check condition
			// as an expression Collect can evaluate (SurveyValidator does the same, with Spring's managers around it)
			ExpressionValidator expressions = new ExpressionValidator(survey.getContext().getExpressionFactory());
			SurveyValidator names = new SurveyValidator();
			for (AttributeDefinition def : survey.getSchema().getRootEntityDefinitions().get(0).getChildDefinitions().stream()
					.filter(AttributeDefinition.class::isInstance).map(AttributeDefinition.class::cast).collect(Collectors.toList())) {
				String where = file.getName() + ": " + def.getName();
				if (!names.validateNodeName(def.getName())) {
					problems.add(where + ": not a valid name");
				}
				List<String> expressionsOf = new ArrayList<>();
				if (def.getRelevantExpression() != null) {
					expressionsOf.add(def.getRelevantExpression());
				}
				for (Check<?> check : def.getChecks()) {
					if (check instanceof CustomCheck) {
						expressionsOf.add(check.getExpression());
					}
					if (check.getCondition() != null) {
						expressionsOf.add(check.getCondition());
					}
				}
				for (String expression : expressionsOf) {
					ExpressionValidationResult result = expressions.validateBooleanExpression(def.getParentDefinition(), def, expression);
					if (result.isError()) {
						problems.add(where + ": " + expression + " -> " + result.getMessage() + " " + Arrays.toString(result.getMessageArgs()));
					}
				}
			}
			Map<String, Object> model = new SurveyFormModelBuilder(survey, "en", null).build();
			List<Map<String, Object>> tabs = (List<Map<String, Object>>) model.get("tabs");
			if (tabs == null || tabs.isEmpty()) {
				problems.add(file.getName() + ": the form has no tab");
			}
			List<?> unsupported = (List<?>) model.get("unsupported");
			if (unsupported != null && !unsupported.isEmpty()) {
				problems.add(file.getName() + ": fields the form cannot show " + unsupported);
			}
		}
		assertTrue(problems.isEmpty(), problems.size() + " problem(s) in " + files.size() + " survey(s):\n" + String.join("\n", problems.subList(0, Math.min(40, problems.size()))));
	}

	private static List<File> surveyFiles() throws Exception {
		String dir = System.getProperty("ceo.idml.dir");
		File folder;
		if (dir != null && !dir.isEmpty()) {
			folder = new File(dir);
		} else {
			URL url = CeoSurveyIdmlTest.class.getResource("/ceo");
			if (url == null) {
				return new ArrayList<>();
			}
			folder = new File(url.toURI());
		}
		File[] found = folder.listFiles((d, name) -> name.endsWith(".idm.xml"));
		List<File> files = new ArrayList<>(found == null ? Arrays.asList() : Arrays.asList(found));
		files.sort(null);
		return files;
	}
}

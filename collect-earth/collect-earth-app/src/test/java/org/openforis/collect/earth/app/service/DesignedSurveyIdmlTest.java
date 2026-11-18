package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.openforis.collect.manager.CodeListManager;
import org.openforis.collect.manager.SpeciesManager;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.manager.validation.SurveyValidator;
import org.openforis.collect.manager.validation.SurveyValidator.SurveyValidationResult;
import org.openforis.collect.manager.validation.SurveyValidator.SurveyValidationResults;
import org.openforis.collect.manager.validation.SurveyValidator.ValidationParameters;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.BooleanAttributeDefinition;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.CodeList;
import org.openforis.idm.metamodel.CoordinateAttributeDefinition;
import org.openforis.idm.metamodel.DateAttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NodeDefinitionVisitor;
import org.openforis.idm.metamodel.NodeLabel;
import org.openforis.idm.metamodel.TextAttributeDefinition;
import org.openforis.idm.metamodel.expression.ExpressionValidator;

/**
 * The surveys the dashboard's survey designer changes (collect-earth-cloud/src/survey, plan
 * docs/plans/2026-11-18-survey-designer.md, stage 0): Collect's templates with the plan's trial changes, written by the
 * cloud's test/surveyTree.test.ts into src/test/resources/designer. Each is checked as Collect's own designer would
 * before publishing it (the IDML schema, then SurveyValidator with Collect Earth's rules of CollectEarthSurveyValidator,
 * collect-server's, which this project does not depend on) and opened as Collect Earth opens a project (the web form).
 * {@code -Ddesigner.idml.dir=<folder>} reads every *.idm.xml of another folder instead.
 */
public class DesignedSurveyIdmlTest {

	/** CollectEarthSurveyValidator's fields Collect Earth needs, with their types */
	private static final Object[][] REQUIRED_FIELDS = { { "id", TextAttributeDefinition.class },
			{ "operator", TextAttributeDefinition.class }, { "location", CoordinateAttributeDefinition.class },
			{ "plot_file", TextAttributeDefinition.class }, { "actively_saved", BooleanAttributeDefinition.class },
			{ "actively_saved_on", DateAttributeDefinition.class } };

	/** CollectEarthSurveyValidator's rules on top of Collect's */
	static class CollectEarthRules extends SurveyValidator {
		private static final Pattern INVALID_NAME = Pattern.compile(".*_\\d*$"); //$NON-NLS-1$

		@Override
		public boolean validateNodeName(String name) {
			return super.validateNodeName(name) && !INVALID_NAME.matcher(name).matches();
		}

		@Override
		protected List<SurveyValidationResult> validateEntity(EntityDefinition def, ValidationParameters parameters) {
			List<SurveyValidationResult> results = super.validateEntity(def, parameters);
			if (def != def.getRootEntity() && def.getAncestorEntityDefinitions().size() > 1) {
				results.add(new SurveyValidationResult(def.getPath(), "survey.validation.collect_earth.nested_entities_not_supported")); //$NON-NLS-1$
			}
			return results;
		}
	}

	@Test
	@SuppressWarnings("unchecked")
	public void theDesignedSurveysOpenInCollectEarth() throws Exception {
		List<File> files = surveyFiles();
		assertFalse(files.isEmpty(), "no survey to read"); //$NON-NLS-1$
		List<String> problems = new ArrayList<>();
		for (File file : files) {
			String name = file.getName();
			SurveyValidator validator = validator();
			try (InputStream is = new FileInputStream(file)) {
				validator.validateAgainstSchema(is);
			} catch (Exception e) {
				problems.add(name + ": not valid IDML: " + e.getMessage()); //$NON-NLS-1$
			}
			CollectSurvey survey;
			try (InputStream is = new FileInputStream(file)) {
				survey = (CollectSurvey) new CollectSurveyIdmlBinder(new CollectSurveyContext()).unmarshal(is, true);
			} catch (Exception e) {
				problems.add(name + ": not read: " + e.getMessage()); //$NON-NLS-1$
				continue;
			}
			setField(validator, "expressionValidator", new ExpressionValidator(survey.getContext().getExpressionFactory())); //$NON-NLS-1$
			SurveyValidationResults results = validator.validate(survey);
			for (SurveyValidationResult r : results.getErrors()) {
				problems.add(name + ": " + r.getPath() + ": " + r.getMessageKey() + " " + Arrays.toString(r.getMessageArgs())); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			}
			EntityDefinition plot = survey.getSchema().getFirstRootEntityDefinition();
			if (!"plot".equals(plot.getName())) { //$NON-NLS-1$
				problems.add(name + ": the root entity is " + plot.getName()); //$NON-NLS-1$
			}
			for (Object[] field : REQUIRED_FIELDS) {
				NodeDefinition def = childNamed(plot, (String) field[0]);
				if (def == null || !((Class<?>) field[1]).isInstance(def)) {
					problems.add(name + ": " + field[0] + " missing or of another type"); //$NON-NLS-1$ //$NON-NLS-2$
				}
			}
			Map<String, Object> model = new SurveyFormModelBuilder(survey, "en", null).build(); //$NON-NLS-1$
			List<Map<String, Object>> tabs = (List<Map<String, Object>>) model.get("tabs"); //$NON-NLS-1$
			if (tabs == null || tabs.isEmpty()) {
				problems.add(name + ": the form has no tab"); //$NON-NLS-1$
			}
			List<?> unsupported = (List<?>) model.get("unsupported"); //$NON-NLS-1$
			if (unsupported != null && !unsupported.isEmpty()) {
				problems.add(name + ": fields the form cannot show " + unsupported); //$NON-NLS-1$
			}
		}
		assertTrue(problems.isEmpty(), problems.size() + " problem(s) in " + files.size() + " survey(s):\n" //$NON-NLS-1$ //$NON-NLS-2$
				+ String.join("\n", problems.subList(0, Math.min(40, problems.size())))); //$NON-NLS-1$
	}

	/** The basic template's trial changes, as Collect reads them */
	@Test
	public void theBasicTemplatesChangesAreWhatTheDesignerAskedFor() throws Exception {
		if (System.getProperty("designer.idml.dir") != null) { //$NON-NLS-1$
			return;
		}
		CollectSurvey survey;
		try (InputStream is = DesignedSurveyIdmlTest.class.getResourceAsStream("/designer/basic.idm.xml")) { //$NON-NLS-1$
			survey = (CollectSurvey) new CollectSurveyIdmlBinder(new CollectSurveyContext()).unmarshal(is, true);
		}
		EntityDefinition plot = survey.getSchema().getFirstRootEntityDefinition();
		BooleanAttributeDefinition water = (BooleanAttributeDefinition) plot.getChildDefinition("has_water"); //$NON-NLS-1$
		assertEquals("¿Hay agua?", water.getLabel(NodeLabel.Type.INSTANCE, "es")); //$NON-NLS-1$ //$NON-NLS-2$
		CodeAttributeDefinition kind = (CodeAttributeDefinition) plot.getChildDefinition("water_kind"); //$NON-NLS-1$
		assertEquals("has_water = true()", kind.getRelevantExpression()); //$NON-NLS-1$
		assertTrue(kind.isAlwaysRequired());
		assertEquals(Arrays.asList("river", "lake", "pond"), codes(kind.getList())); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		assertEquals(Arrays.asList("A", "B", "C"), codes(survey.getCodeList("demo_codelist"))); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		assertEquals("Une question à choix", plot.getChildDefinition("code_demo").getLabel(NodeLabel.Type.INSTANCE, "fr")); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		assertEquals(null, childNamed(plot, "memo_text_demo")); //$NON-NLS-1$
		List<String> order = new ArrayList<>();
		plot.getChildDefinitions().forEach(d -> order.add(d.getName()));
		assertEquals(order.indexOf("short_text_demo") - 1, order.indexOf("integer_demo")); //$NON-NLS-1$ //$NON-NLS-2$
		assertEquals("tree_count", order.get(order.size() - 1)); //$NON-NLS-1$
		assertEquals(1, ((AttributeDefinition) plot.getChildDefinition("tree_count")).getChecks().size()); //$NON-NLS-1$
	}

	private static NodeDefinition childNamed(EntityDefinition entity, String name) {
		return entity.getChildDefinitions().stream().filter(d -> d.getName().equals(name)).findFirst().orElse(null);
	}

	private static List<String> codes(CodeList list) {
		List<String> codes = new ArrayList<>();
		list.getItems().forEach(i -> codes.add(i.getCode()));
		return codes;
	}

	/** Collect's validator with Collect Earth's rules, its managers answering from the survey alone */
	private static SurveyValidator validator() throws Exception {
		CollectEarthRules validator = new CollectEarthRules();
		SurveyManager surveys = mock(SurveyManager.class);
		when(surveys.loadSurveyFileSummaries(any())).thenReturn(Collections.emptyList());
		CodeListManager lists = mock(CodeListManager.class);
		when(lists.isInUse(any())).thenAnswer(a -> isInUse(a.getArgument(0)));
		when(lists.isEmpty(any())).thenAnswer(a -> ((CodeList) a.getArgument(0)).getItems().isEmpty());
		setField(validator, "surveyManager", surveys); //$NON-NLS-1$
		setField(validator, "codeListManager", lists); //$NON-NLS-1$
		setField(validator, "speciesManager", mock(SpeciesManager.class)); //$NON-NLS-1$
		return validator;
	}

	private static boolean isInUse(CodeList list) {
		boolean[] used = { false };
		for (EntityDefinition root : list.getSurvey().getSchema().getRootEntityDefinitions()) {
			root.traverse((NodeDefinitionVisitor) def -> {
				if (def instanceof CodeAttributeDefinition && ((CodeAttributeDefinition) def).getList() == list) {
					used[0] = true;
				}
			});
		}
		return used[0];
	}

	private static void setField(Object target, String name, Object value) throws Exception {
		Field field = SurveyValidator.class.getDeclaredField(name);
		field.setAccessible(true);
		field.set(target, value);
	}

	private static List<File> surveyFiles() throws Exception {
		String dir = System.getProperty("designer.idml.dir"); //$NON-NLS-1$
		File folder;
		if (dir != null && !dir.isEmpty()) {
			folder = new File(dir);
		} else {
			URL url = DesignedSurveyIdmlTest.class.getResource("/designer"); //$NON-NLS-1$
			if (url == null) {
				return new ArrayList<>();
			}
			folder = new File(url.toURI());
		}
		File[] found = folder.listFiles((d, n) -> n.endsWith(".idm.xml")); //$NON-NLS-1$
		List<File> files = new ArrayList<>(found == null ? Arrays.asList() : Arrays.asList(found));
		files.sort(null);
		return files;
	}
}

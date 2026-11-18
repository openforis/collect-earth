package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.expression.ExpressionValidator;
import org.openforis.idm.metamodel.expression.ExpressionValidator.ExpressionType;
import org.openforis.idm.metamodel.expression.ExpressionValidator.ExpressionValidationResult;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

/**
 * Collect's verdict on each expression of the survey designer's corpus (collect-earth-cloud's
 * test/expressionCheck.test.ts writes src/test/resources/designer/expressions.json): Collect's ExpressionValidator, called as
 * its SurveyValidator calls it (from the node's parent, the node as $this). The verdicts are kept in
 * expression-verdicts.json beside it, which the cloud's test holds its own checker to. A verdict that changes (a new
 * Collect) fails here; {@code -Ddesigner.update=true} writes them again.
 */
public class ExpressionVerdictsTest {

	/** One expression of the corpus */
	static class Entry {
		String id;
		String survey;
		String node;
		String kind;
		String expression;
	}

	/** Collect's verdict: ok, or its message */
	static class Verdict {
		boolean ok;
		String message;

		Verdict(boolean ok, String message) {
			this.ok = ok;
			this.message = message;
		}
	}

	@Test
	public void collectsVerdictsAreTheOnesKept() throws Exception {
		File folder = new File(ExpressionVerdictsTest.class.getResource("/designer").toURI());
		// The resources as in the repository, not as copied to target/test-classes
		File sources = new File("src/test/resources/designer"); //$NON-NLS-1$
		File corpusFile = new File(sources.isDirectory() ? sources : folder, "expressions.json"); //$NON-NLS-1$
		File verdictsFile = new File(sources.isDirectory() ? sources : folder, "expression-verdicts.json"); //$NON-NLS-1$
		assertTrue(corpusFile.isFile(), "no corpus: run the cloud's test/expressionCheck.test.ts"); //$NON-NLS-1$
		// The surveys are named from the repository's root: two folders up from this module's
		File repository = new File("").getAbsoluteFile().getParentFile().getParentFile(); //$NON-NLS-1$

		Gson gson = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().serializeNulls().create();
		List<Entry> corpus;
		try (Reader reader = Files.newBufferedReader(corpusFile.toPath(), StandardCharsets.UTF_8)) {
			corpus = gson.fromJson(reader, new TypeToken<List<Entry>>() {
			}.getType());
		}
		assertFalse(corpus.isEmpty());

		Map<String, CollectSurvey> surveys = new HashMap<>();
		Map<String, Verdict> verdicts = new LinkedHashMap<>();
		for (Entry e : corpus) {
			CollectSurvey survey = surveys.get(e.survey);
			if (survey == null) {
				try (InputStream is = new FileInputStream(new File(repository, e.survey))) {
					survey = (CollectSurvey) new CollectSurveyIdmlBinder(new CollectSurveyContext()).unmarshal(is, true);
				}
				surveys.put(e.survey, survey);
			}
			NodeDefinition node = nodeAt(survey, e.node);
			ExpressionValidator validator = new ExpressionValidator(survey.getContext().getExpressionFactory());
			ExpressionType type = "path".equals(e.kind) ? ExpressionType.SCHEMA_PATH //$NON-NLS-1$
					: "value".equals(e.kind) ? ExpressionType.VALUE : ExpressionType.BOOLEAN; //$NON-NLS-1$
			ExpressionValidationResult result;
			try {
				result = validator.validateExpression(type, node.getParentDefinition(), node, e.expression);
			} catch (RuntimeException ex) {
				// What Collect's survey designer would show as an error too
				result = new ExpressionValidationResult(ExpressionValidator.ExpressionValidationResultFlag.ERROR, String.valueOf(ex.getMessage()));
			}
			verdicts.put(e.id, new Verdict(result.isOk(), result.isOk() ? null : result.getMessage()));
		}

		String written = gson.toJson(verdicts) + "\n"; //$NON-NLS-1$
		if (Boolean.getBoolean("designer.update") || !verdictsFile.isFile()) { //$NON-NLS-1$
			try (Writer w = Files.newBufferedWriter(verdictsFile.toPath(), StandardCharsets.UTF_8)) {
				w.write(written);
			}
			return;
		}
		Map<String, Verdict> kept;
		try (Reader reader = Files.newBufferedReader(verdictsFile.toPath(), StandardCharsets.UTF_8)) {
			kept = gson.fromJson(reader, new TypeToken<Map<String, Verdict>>() {
			}.getType());
		}
		List<String> changed = new ArrayList<>();
		for (Map.Entry<String, Verdict> v : verdicts.entrySet()) {
			Verdict before = kept.get(v.getKey());
			if (before == null || before.ok != v.getValue().ok) {
				changed.add(v.getKey() + ": " + (before == null ? "new" : before.ok + " -> " + v.getValue().ok)); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			}
		}
		assertTrue(changed.isEmpty() && kept.size() == verdicts.size(),
				"Collect's verdicts changed (-Ddesigner.update=true writes them again, then run the cloud's test):\n" + String.join("\n", changed)); //$NON-NLS-1$ //$NON-NLS-2$
	}

	private static NodeDefinition nodeAt(CollectSurvey survey, String path) {
		String[] names = path.split("/"); //$NON-NLS-1$
		NodeDefinition at = survey.getSchema().getRootEntityDefinition(names[0]);
		for (int i = 1; i < names.length; i++) {
			at = ((EntityDefinition) at).getChildDefinition(names[i]);
		}
		return at;
	}
}

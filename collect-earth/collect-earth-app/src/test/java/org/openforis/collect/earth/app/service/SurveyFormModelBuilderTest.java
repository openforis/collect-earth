package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.idm.metamodel.NumericAttributeDefinition;
import org.openforis.idm.metamodel.RangeAttributeDefinition;
import org.openforis.idm.metamodel.Schema;

/**
 * The web form model built from the IPCC test survey (test_survey.idm.xml), checked against what the
 * balloon of the same survey shows.
 */
@SuppressWarnings("unchecked")
public class SurveyFormModelBuilderTest {

	private static CollectSurvey survey;
	private static Map<String, Object> model;

	@BeforeAll
	public static void build() throws Exception {
		try (InputStream is = SurveyFormModelBuilderTest.class.getResourceAsStream("/test_survey.idm.xml")) {
			assertNotNull(is, "test_survey.idm.xml fixture missing");
			survey = (CollectSurvey) new CollectSurveyIdmlBinder(new CollectSurveyContext()).unmarshal(is, true);
		}
		model = new SurveyFormModelBuilder(survey, "en", null).build();
	}

	private static List<Map<String, Object>> tabs() {
		return (List<Map<String, Object>>) model.get("tabs");
	}

	/** Every field of the form, in tables and groups too. */
	private static List<Map<String, Object>> allFields(Map<String, Object> m) {
		List<Map<String, Object>> fields = new ArrayList<>();
		for (Map<String, Object> tab : (List<Map<String, Object>>) m.get("tabs")) {
			for (Map<String, Object> item : (List<Map<String, Object>>) tab.get("items")) {
				if ("field".equals(item.get("kind"))) fields.add(item);
				if (item.containsKey("fields")) fields.addAll((List<Map<String, Object>>) item.get("fields"));
				if (item.containsKey("rows")) {
					for (Map<String, Object> row : (List<Map<String, Object>>) item.get("rows")) {
						fields.addAll((List<Map<String, Object>>) row.get("fields"));
					}
				}
			}
		}
		return fields;
	}

	private static Map<String, Object> field(String name) {
		return allFields(model).stream().filter(f -> name.equals(f.get("name"))).findFirst().orElse(null);
	}

	@Test
	public void oneTabPerFormInSurveyOrder() {
		List<String> labels = tabs().stream().map(t -> (String) t.get("label")).collect(Collectors.toList());
		assertEquals(List.of("Imagery", "Land cover", "IPCC", "Disturbance", "Notes"), labels);
	}

	@Test
	public void keysAndCsvFieldsAreSentNotShown() {
		assertEquals(List.of("collect_text_id"), model.get("keys"));
		List<String> csv = (List<String>) model.get("csvFields");
		assertTrue(csv.contains("collect_integer_elevation"), csv.toString());
		assertTrue(csv.contains("collect_code_climate"), csv.toString());
		assertFalse(csv.contains("collect_text_id"), "keys come from the plot id, not the CSV extra columns");
		for (String hidden : List.of("collect_text_id", "collect_text_operator", "collect_coord_location",
				"collect_boolean_actively_saved", "collect_integer_elevation", "collect_code_climate")) {
			assertNull(field(hidden), hidden + " must not be a visible field");
		}
	}

	@Test
	public void headerDataBecomesInfoLines() {
		List<String> info = new ArrayList<>();
		for (Map<String, Object> tab : tabs()) {
			for (Map<String, Object> item : (List<Map<String, Object>>) tab.get("items")) {
				if ("info".equals(item.get("kind"))) info.add((String) item.get("name"));
			}
		}
		assertTrue(info.contains("collect_text_country"), info.toString());
		assertTrue(info.contains("collect_text_region"), info.toString());
	}

	@Test
	public void hierarchicalCodesPointToTheirParentAndCarryItemsOfTheirLevel() {
		Map<String, Object> subdivision = field("collect_code_land_use_subdivision");
		assertNotNull(subdivision);
		Map<String, Object> code = (Map<String, Object>) subdivision.get("code");
		assertEquals("collect_code_land_use_category", code.get("parent"));
		assertEquals("dropdown", code.get("layout"));
		List<Map<String, Object>> items = (List<Map<String, Object>>) code.get("items");
		assertTrue(items.stream().anyMatch(i -> "broadleaf_dec".equals(i.get("code"))), "second level items");
		assertTrue(items.stream().allMatch(i -> i.get("parentId") != null), "every child item names its parent");

		Map<String, Object> category = (Map<String, Object>) field("collect_code_land_use_category").get("code");
		List<Map<String, Object>> rootItems = (List<Map<String, Object>>) category.get("items");
		assertTrue(rootItems.stream().anyMatch(i -> "F".equals(i.get("code"))));
		assertTrue(rootItems.stream().noneMatch(i -> i.containsKey("parentId")));
		assertEquals("buttons", category.get("layout"));
	}

	@Test
	public void enumeratedEntityBecomesATableWithOneRowPerItem() {
		Map<String, Object> table = null;
		for (Map<String, Object> tab : tabs()) {
			for (Map<String, Object> item : (List<Map<String, Object>>) tab.get("items")) {
				if ("table".equals(item.get("kind"))) table = item;
			}
		}
		assertNotNull(table, "land_cover table");
		List<Map<String, Object>> rows = (List<Map<String, Object>>) table.get("rows");
		assertFalse(rows.isEmpty());
		Map<String, Object> row = rows.get(0);
		List<Map<String, Object>> fields = (List<Map<String, Object>>) row.get("fields");
		assertEquals("collect_entity_land_cover[" + row.get("code") + "].code_coverage", fields.get(0).get("name"));
		assertEquals(((List<?>) table.get("columns")).size(), fields.size(), "one control per column");
	}

	@Test
	public void calculatedAndMultipleFlags() {
		assertEquals(Boolean.TRUE, field("collect_code_disturbance_type").get("multiple"));
		Map<String, Object> calculated = field("collect_code_calculated_elevation_range");
		if (calculated != null) {
			assertEquals(Boolean.TRUE, calculated.get("readOnly"));
		}
		assertEquals("memo", field("collect_text_comments").get("type"));
		assertEquals("date", field("collect_date_rs_date").get("type"));
	}

	@Test
	public void rangesAreFieldsOfTheirOwnType() {
		Schema schema = survey.getSchema();
		RangeAttributeDefinition integerRange = schema.createRangeAttributeDefinition();
		integerRange.setType(NumericAttributeDefinition.Type.INTEGER);
		RangeAttributeDefinition realRange = schema.createRangeAttributeDefinition();
		realRange.setType(NumericAttributeDefinition.Type.REAL);

		assertEquals("integerRange", SurveyFormModelBuilder.fieldType(integerRange));
		assertEquals("realRange", SurveyFormModelBuilder.fieldType(realRange));
	}

	@Test
	public void hiddenAttributesAreLeftOut() {
		assertNull(field("collect_boolean_land_use_category_has_changed"), "ui:hide");
	}

	@Test
	public void labelsFollowTheRequestedLanguageWithFallback() {
		Map<String, Object> es = new SurveyFormModelBuilder(survey, "ES", null).build();
		List<String> labels = ((List<Map<String, Object>>) es.get("tabs")).stream()
				.map(t -> (String) t.get("label")).collect(Collectors.toList());
		assertTrue(labels.contains("Parcela"), labels.toString());
		assertTrue(labels.contains("Imagery"), "untranslated labels fall back to English: " + labels);
	}
}

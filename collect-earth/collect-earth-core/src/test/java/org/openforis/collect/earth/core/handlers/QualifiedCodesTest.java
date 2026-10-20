package org.openforis.collect.earth.core.handlers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.core.model.PlacemarkInputFieldInfo;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.model.RecordUpdater;
import org.openforis.collect.model.validation.CollectValidator;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.CodeList;
import org.openforis.idm.metamodel.CodeListItem;
import org.openforis.idm.metamodel.CodeListService;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.ModelVersion;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.model.Code;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.expression.ExpressionFactory;

/**
 * Qualifiable code list items ( "Other, specify" ). The text the interpreter wrote was dropped both ways : it was never saved,
 * and a qualifier stored by Collect never came back to the balloon.
 */
class QualifiedCodesTest {

	private static final String SPECIES = "collect_code_main_species";
	private static final String OTHER_SPECIES = "collect_code_other_species";

	private final BalloonInputFieldsUtils balloonInputFieldsUtils = new BalloonInputFieldsUtils();
	private CollectRecord record;
	private Entity plot;
	private CodeListItem other;

	@BeforeEach
	void createPlot() {
		CollectSurvey survey = new CollectSurveyContext(new ExpressionFactory(), new CollectValidator(),
				new InMemoryCodeListService()).createSurvey();
		survey.setName("test");
		Schema schema = survey.getSchema();

		CodeList species = survey.createCodeList();
		species.setName("species");
		species.addItem(item(species, "pine", false));
		other = item(species, "other", true);
		species.addItem(other);
		survey.addCodeList(species);

		EntityDefinition plotDefinition = schema.createEntityDefinition();
		plotDefinition.setName("plot");
		schema.addRootEntityDefinition(plotDefinition);

		CodeAttributeDefinition mainSpecies = schema.createCodeAttributeDefinition();
		mainSpecies.setName("main_species");
		mainSpecies.setList(species);
		plotDefinition.addChildDefinition(mainSpecies);

		CodeAttributeDefinition otherSpecies = schema.createCodeAttributeDefinition();
		otherSpecies.setName("other_species");
		otherSpecies.setList(species);
		otherSpecies.setMultiple(true);
		plotDefinition.addChildDefinition(otherSpecies);

		record = new CollectRecord(survey, null, "plot");
		new RecordUpdater().initializeNewRecord(record);
		plot = record.getRootEntity();
	}

	private static CodeListItem item(CodeList list, String code, boolean qualifiable) {
		CodeListItem item = list.createItem(1);
		item.setCode(code);
		item.setLabel("en", code);
		item.setQualifiable(qualifiable);
		return item;
	}

	private void save(String parameterName, String value) {
		Map<String, String> parameters = new HashMap<>();
		parameters.put(parameterName, value);
		Map<String, String> invalidValues = new LinkedHashMap<>();
		balloonInputFieldsUtils.saveToEntity(parameters, plot, false, invalidValues);
		assertTrue(invalidValues.isEmpty(), invalidValues.toString());
	}

	private Code code(String name, int index) {
		return ((CodeAttribute) plot.getChild(name, index)).getValue();
	}

	@Test
	void theQualifierIsSavedWithItsCode() {
		save(SPECIES, "other::Eucalyptus globulus");

		assertEquals("other", code("main_species", 0).getCode());
		assertEquals("Eucalyptus globulus", code("main_species", 0).getQualifier());
	}

	@Test
	void theBalloonGetsTheQualifierBack() {
		save(SPECIES, "other::Eucalyptus");

		assertEquals("other::Eucalyptus", balloonInputFieldsUtils.getValuesByHtmlParameters(plot).get(SPECIES));
	}

	@Test
	void aCodeWithoutQualifierIsUnchanged() {
		save(SPECIES, "pine");

		assertEquals("pine", code("main_species", 0).getCode());
		assertNull(code("main_species", 0).getQualifier());
		assertEquals("pine", balloonInputFieldsUtils.getValuesByHtmlParameters(plot).get(SPECIES));
	}

	@Test
	void choosingAnotherItemDropsTheQualifier() {
		save(SPECIES, "other::Eucalyptus");
		save(SPECIES, "pine");

		assertEquals("pine", code("main_species", 0).getCode());
		assertNull(code("main_species", 0).getQualifier());
	}

	@Test
	void anEmptyQualifierIsNoQualifier() {
		save(SPECIES, "other:: ");

		assertEquals("other", code("main_species", 0).getCode());
		assertNull(code("main_species", 0).getQualifier());
	}

	@Test
	void aQualifierCanHoldColons() {
		save(SPECIES, "other::Pinus sp. :: 2 rows");

		assertEquals("Pinus sp. :: 2 rows", code("main_species", 0).getQualifier());
	}

	@Test
	void eachValueOfAMultipleAttributeKeepsItsQualifier() {
		save(OTHER_SPECIES, "pine===other::Teak");

		assertEquals("pine", code("other_species", 0).getCode());
		assertEquals("other", code("other_species", 1).getCode());
		assertEquals("Teak", code("other_species", 1).getQualifier());
		assertEquals("pine===other::Teak", balloonInputFieldsUtils.getValuesByHtmlParameters(plot).get(OTHER_SPECIES));
	}

	@Test
	void theSelectedItemIsFoundWhenItHasAQualifier() {
		save(SPECIES, "other::Eucalyptus");

		Map<String, PlacemarkInputFieldInfo> infos = balloonInputFieldsUtils.extractFieldInfoByParameterName(record, null,
				"en", null);

		PlacemarkInputFieldInfo info = infos.get(SPECIES);
		assertEquals("other::Eucalyptus", info.getValue());
		assertEquals(other.getId(), info.getCodeItemId(), "The balloon shows the children of the item, and selects it");
	}

	/** The items of the code lists of the survey, without a database */
	private static class InMemoryCodeListService implements CodeListService {

		@SuppressWarnings("unchecked")
		@Override
		public <T extends CodeListItem> T loadItem(CodeAttribute attribute) {
			Code value = attribute.getValue();
			for (CodeListItem item : attribute.getDefinition().getList().getItems()) {
				if (value != null && item.getCode().equals(value.getCode())) {
					return (T) item;
				}
			}
			return null;
		}

		@Override
		public <T extends CodeListItem> List<T> loadRootItems(CodeList codeList) {
			return codeList.getItems();
		}

		@Override
		public <T extends CodeListItem> T loadRootItem(CodeList list, String code, ModelVersion version) {
			return null;
		}

		@Override
		public <T extends CodeListItem> List<T> loadChildItems(T parentItem) {
			return parentItem.getChildItems();
		}

		@Override
		public <T extends CodeListItem> List<T> loadItems(CodeList codeList, int level) {
			return codeList.getItems();
		}

		@Override
		public boolean hasItems(Entity parent, CodeAttributeDefinition def) {
			return !def.getList().getItems().isEmpty();
		}

		@Override
		public <T extends CodeListItem> List<T> loadValidItems(Entity parent, CodeAttributeDefinition def) {
			return new ArrayList<>(def.getList().<T>getItems());
		}

		@Override
		public <T extends CodeListItem> T loadParentItem(T item) {
			return null;
		}

		@Override
		public boolean hasQualifiableItems(CodeList codeList) {
			return codeList.getItems().stream().anyMatch(CodeListItem::isQualifiable);
		}

		@Override
		public <T extends CodeListItem> void save(T item) {
		}

		@Override
		public <T extends CodeListItem> void save(List<T> items) {
		}

		@Override
		public <T extends CodeListItem> void delete(T item) {
		}

		@Override
		public void deleteAllItems(CodeList list) {
		}
	}
}

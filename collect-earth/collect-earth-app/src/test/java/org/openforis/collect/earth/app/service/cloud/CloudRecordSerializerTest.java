package org.openforis.collect.earth.app.service.cloud;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.InputStream;
import java.util.Collections;
import java.util.Date;
import java.util.List;

import org.junit.BeforeClass;
import org.junit.Test;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.model.RecordUpdater;
import org.openforis.collect.model.validation.CollectValidator;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.CodeList;
import org.openforis.idm.metamodel.CodeListItem;
import org.openforis.idm.metamodel.CodeListService;
import org.openforis.idm.metamodel.ModelVersion;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.TextAttribute;
import org.openforis.idm.model.TextValue;
import org.openforis.idm.model.Value;
import org.openforis.idm.model.expression.ExpressionFactory;

/**
 * Round-trip test pinning the behaviour of the (internal) Collect
 * DataMarshaller/DataUnmarshaller pair that the cloud sync payload relies on:
 * record → XML → record must preserve keys, operator and modified date.
 */
public class CloudRecordSerializerTest {

	private static final String OPERATOR_NAME = "test_operator";

	private static CollectSurvey survey;
	private static RecordUpdater recordUpdater;

	@BeforeClass
	public static void loadSurvey() throws Exception {
		try (InputStream is = CloudRecordSerializerTest.class.getResourceAsStream("/test_survey.idm.xml")) {
			assertNotNull("test_survey.idm.xml fixture missing", is);
			// Provide a stub CodeListService so that initializeNewRecord() can apply
			// code-list default values without a backing database (the default no-arg
			// CollectSurveyContext leaves codeListService null, which NPEs on loadRootItems).
			CollectSurveyContext context = new CollectSurveyContext(new ExpressionFactory(), new CollectValidator(),
					new EmptyCodeListService());
			CollectSurveyIdmlBinder binder = new CollectSurveyIdmlBinder(context);
			survey = (CollectSurvey) binder.unmarshal(is, true);
		}
		recordUpdater = new RecordUpdater();
		// The test survey is loaded standalone (no persistence layer), so skip the
		// validation pass that would otherwise require database-backed services.
		recordUpdater.setValidateAfterUpdate(false);
	}

	private CollectRecord createRecordWithKey(String keyValue) {
		CollectRecord record = new CollectRecord(survey, null, "plot");
		recordUpdater.initializeNewRecord(record);

		List<AttributeDefinition> keyDefs = record.getRootEntity().getDefinition().getKeyAttributeDefinitions();
		assertFalse("survey has no key attributes", keyDefs.isEmpty());
		for (AttributeDefinition keyDef : keyDefs) {
			@SuppressWarnings("unchecked")
			Attribute<?, Value> keyAttr = (Attribute<?, Value>) record.findNodeByPath(keyDef.getPath());
			Value keyVal = keyDef.createValue(keyValue);
			recordUpdater.updateAttribute(keyAttr, keyVal);
		}

		TextAttribute operator = (TextAttribute) record.findNodeByPath("plot/operator");
		assertNotNull("demo survey should have plot/operator", operator);
		recordUpdater.updateAttribute(operator, new TextValue(OPERATOR_NAME));

		record.setModifiedDate(new Date());
		// Refresh the cached root-entity key list (normally done by RecordManager on
		// save) so getRootEntityKeyValues() reflects the values just set.
		record.updateSummaryFields();
		return record;
	}

	@Test
	public void serializeProducesEnvelopeWithXmlAndSummary() throws Exception {
		CollectRecord record = createRecordWithKey("77");
		CloudRecordSerializer serializer = new CloudRecordSerializer();

		RecordEnvelope envelope = serializer.serialize(record, "77", survey.getUri());

		assertEquals("77", envelope.getRecordKey());
		assertEquals(survey.getUri(), envelope.getSurveyUri());
		assertEquals(OPERATOR_NAME, envelope.getOperator());
		assertNotNull(envelope.getModifiedOn());
		assertTrue("XML should contain the root entity", envelope.getXml().contains("<plot"));
		assertFalse("summary map should not be empty", envelope.getSummary().isEmpty());
		assertEquals(OPERATOR_NAME, envelope.getSummary().get("collect_text_operator"));
		assertFalse(envelope.isDeleted());
	}

	@Test
	public void xmlRoundTripPreservesKeysAndValues() throws Exception {
		CollectRecord original = createRecordWithKey("42");
		CloudRecordSerializer serializer = new CloudRecordSerializer();

		RecordEnvelope envelope = serializer.serialize(original, "42", survey.getUri());
		CollectRecord parsed = serializer.deserialize(envelope.getXml(), survey);

		assertEquals(original.getRootEntityKeyValues(), parsed.getRootEntityKeyValues());
		TextAttribute parsedOperator = (TextAttribute) parsed.findNodeByPath("plot/operator");
		assertEquals(OPERATOR_NAME, parsedOperator.getValue().getValue());
	}

	@Test
	public void tombstoneEnvelopeCarriesNoPayload() {
		RecordEnvelope tombstone = CloudRecordSerializer.tombstone("99", survey.getUri(), OPERATOR_NAME, new Date());
		assertTrue(tombstone.isDeleted());
		assertEquals("99", tombstone.getRecordKey());
		assertEquals(OPERATOR_NAME, tombstone.getOperator());
		assertTrue(tombstone.getXml() == null || tombstone.getXml().isEmpty());
	}

	/** No-op {@link CodeListService} returning empty results, enough for record initialization in tests. */
	private static class EmptyCodeListService implements CodeListService {
		@Override
		public <T extends CodeListItem> T loadItem(CodeAttribute attribute) {
			return null;
		}

		@Override
		public <T extends CodeListItem> List<T> loadRootItems(CodeList codeList) {
			return Collections.emptyList();
		}

		@Override
		public <T extends CodeListItem> T loadRootItem(CodeList list, String code, ModelVersion version) {
			return null;
		}

		@Override
		public <T extends CodeListItem> List<T> loadChildItems(T parentItem) {
			return Collections.emptyList();
		}

		@Override
		public <T extends CodeListItem> List<T> loadItems(CodeList codeList, int level) {
			return Collections.emptyList();
		}

		@Override
		public boolean hasItems(Entity parent, CodeAttributeDefinition def) {
			return false;
		}

		@Override
		public <T extends CodeListItem> List<T> loadValidItems(Entity parent, CodeAttributeDefinition def) {
			return Collections.emptyList();
		}

		@Override
		public <T extends CodeListItem> T loadParentItem(T item) {
			return null;
		}

		@Override
		public boolean hasQualifiableItems(CodeList codeList) {
			return false;
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

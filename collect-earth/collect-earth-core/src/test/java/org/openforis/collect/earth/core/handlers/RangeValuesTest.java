package org.openforis.collect.earth.core.handlers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.model.RecordUpdater;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NumberAttributeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition.Type;
import org.openforis.idm.metamodel.RangeAttributeDefinition;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.IntegerRange;
import org.openforis.idm.model.IntegerValue;
import org.openforis.idm.model.NumericRange;
import org.openforis.idm.model.RealRange;

/**
 * Range attributes. "integer_range_" parameters used to be taken by the integer handler, which starts with "integer_" too, and
 * found no attribute to save them into; the range handler built a whole number instead of a range; and real ranges had no
 * handler at all.
 */
class RangeValuesTest {

	private static final String TREE_HEIGHT = "collect_integer_range_tree_height";
	private static final String SLOPE = "collect_real_range_slope";
	private static final String STAND_AGE = "collect_entity_stand.integer_range_age";
	private static final String COUNT = "collect_integer_tree_count";

	private final BalloonInputFieldsUtils balloonInputFieldsUtils = new BalloonInputFieldsUtils();
	private Entity plot;

	@BeforeEach
	void createPlot() {
		CollectSurvey survey = new CollectSurveyContext().createSurvey();
		survey.setName("test");
		Schema schema = survey.getSchema();

		EntityDefinition plotDefinition = schema.createEntityDefinition();
		plotDefinition.setName("plot");
		schema.addRootEntityDefinition(plotDefinition);

		RangeAttributeDefinition treeHeight = schema.createRangeAttributeDefinition();
		treeHeight.setName("tree_height");
		treeHeight.setType(Type.INTEGER);
		plotDefinition.addChildDefinition(treeHeight);

		RangeAttributeDefinition slope = schema.createRangeAttributeDefinition();
		slope.setName("slope");
		slope.setType(Type.REAL);
		plotDefinition.addChildDefinition(slope);

		NumberAttributeDefinition count = schema.createNumberAttributeDefinition();
		count.setName("tree_count");
		count.setType(Type.INTEGER);
		plotDefinition.addChildDefinition(count);

		EntityDefinition stand = schema.createEntityDefinition();
		stand.setName("stand");
		plotDefinition.addChildDefinition(stand);
		RangeAttributeDefinition age = schema.createRangeAttributeDefinition();
		age.setName("age");
		age.setType(Type.INTEGER);
		stand.addChildDefinition(age);

		CollectRecord record = new CollectRecord(survey, null, "plot");
		new RecordUpdater().initializeNewRecord(record);
		plot = record.getRootEntity();
	}

	private Map<String, String> save(String parameterName, String value) {
		Map<String, String> parameters = new HashMap<>();
		parameters.put(parameterName, value);
		Map<String, String> invalidValues = new LinkedHashMap<>();
		balloonInputFieldsUtils.saveToEntity(parameters, plot, false, invalidValues);
		return invalidValues;
	}

	private static Object value(Entity entity, String name) {
		return ((Attribute<?, ?>) entity.getChild(name)).getValue();
	}

	private static NumericRange<?> range(Entity entity, String name) {
		return (NumericRange<?>) value(entity, name);
	}

	@Test
	void eachRangeParameterGoesToTheRangeHandlerOfItsType() {
		assertInstanceOf(RangeAttributeHandler.class, balloonInputFieldsUtils.findHandler("integer_range_tree_height"));
		assertInstanceOf(RangeAttributeHandler.class, balloonInputFieldsUtils.findHandler("real_range_slope"));
		assertInstanceOf(IntegerAttributeHandler.class, balloonInputFieldsUtils.findHandler("integer_tree_count"));
		assertInstanceOf(RealAttributeHandler.class, balloonInputFieldsUtils.findHandler("real_canopy_cover"));
	}

	@Test
	void anIntegerRangeIsSaved() {
		assertTrue(save(TREE_HEIGHT, "10-20").isEmpty());

		NumericRange<?> value = range(plot, "tree_height");
		assertInstanceOf(IntegerRange.class, value);
		assertEquals(10, value.getFrom());
		assertEquals(20, value.getTo());
	}

	@Test
	void aRealRangeIsSavedWithADecimalCommaOrPoint() {
		assertTrue(save(SLOPE, "2,5 - 7.5").isEmpty());

		NumericRange<?> value = range(plot, "slope");
		assertInstanceOf(RealRange.class, value);
		assertEquals(2.5, value.getFrom());
		assertEquals(7.5, value.getTo());
	}

	@Test
	void aSingleNumberIsARangeOfOneValueAndNegativeNumbersKeepTheirSign() {
		save(TREE_HEIGHT, "15");
		assertEquals(15, range(plot, "tree_height").getFrom());
		assertEquals(15, range(plot, "tree_height").getTo());

		save(SLOPE, "-5--2");
		assertEquals(-5.0, range(plot, "slope").getFrom());
		assertEquals(-2.0, range(plot, "slope").getTo());
	}

	@Test
	void aRangeInASingleEntityIsSaved() {
		assertTrue(save(STAND_AGE, "30-40").isEmpty());

		Entity stand = (Entity) plot.getChild("stand");
		assertEquals(30, range(stand, "age").getFrom());
		assertEquals(40, range(stand, "age").getTo());
	}

	@Test
	void theBalloonGetsBackWhatItSent() {
		save(TREE_HEIGHT, "10-20");
		save(SLOPE, "2.5-7");
		save(STAND_AGE, "8");

		Map<String, String> values = balloonInputFieldsUtils.getValuesByHtmlParameters(plot);

		assertEquals("10-20", values.get(TREE_HEIGHT));
		assertEquals("2.5-7", values.get(SLOPE));
		assertEquals("8", values.get(STAND_AGE), "A range of one value comes back as that value");
	}

	@Test
	void aMistypedRangeIsReportedOnItsFieldAndKeepsTheValueItHad() {
		save(TREE_HEIGHT, "10-20");

		Map<String, String> invalidValues = save(TREE_HEIGHT, "10 to 20");

		assertTrue(invalidValues.containsKey(TREE_HEIGHT), "Reported under the name of the field in the balloon");
		assertEquals(10, range(plot, "tree_height").getFrom());
		assertEquals(20, range(plot, "tree_height").getTo());
	}

	@Test
	void anEmptyRangeClearsTheAttribute() {
		save(TREE_HEIGHT, "10-20");

		save(TREE_HEIGHT, "");

		// An attribute without a value holds a range with no ends, which the balloon gets back as nothing
		assertNull(range(plot, "tree_height").getFrom());
		assertNull(range(plot, "tree_height").getTo());
		assertNull(balloonInputFieldsUtils.getValuesByHtmlParameters(plot).get(TREE_HEIGHT));
	}

	@Test
	void theHandlersRejectWhatTheyCannotRead() {
		assertThrows(NumberFormatException.class, () -> new RangeAttributeHandler(Type.INTEGER).createValue("1.5-2"));
		assertThrows(NumberFormatException.class, () -> new RangeAttributeHandler(Type.REAL).createValue("abc"));
		assertTrue(BalloonInputFieldsUtils.isTypedByInterpreter(new RangeAttributeHandler(Type.REAL)));
	}

	@Test
	void theIntegerNumbersAreStillSaved() {
		assertTrue(save(COUNT, "12").isEmpty());
		assertEquals(12, ((IntegerValue) value(plot, "tree_count")).getValue());
	}
}

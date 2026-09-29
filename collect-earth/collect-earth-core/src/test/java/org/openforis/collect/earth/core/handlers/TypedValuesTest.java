package org.openforis.collect.earth.core.handlers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
import org.openforis.idm.metamodel.CoordinateAttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NumberAttributeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition.Type;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.metamodel.TimeAttributeDefinition;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.IntegerAttribute;
import org.openforis.idm.model.RealAttribute;

/**
 * Values that the interpreter types in the balloon and that cannot be read (JAVA-COLLECT-EARTH-55W)
 */
class TypedValuesTest {

	private static final String YEAR = "collect_integer_imagery_year_used";
	private static final String COVER = "collect_real_canopy_cover";
	private static final String TIME = "collect_time_survey_time";
	private static final String LOCATION = "collect_coord_location";

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

		NumberAttributeDefinition year = schema.createNumberAttributeDefinition();
		year.setName("imagery_year_used");
		year.setType(Type.INTEGER);
		plotDefinition.addChildDefinition(year);

		NumberAttributeDefinition cover = schema.createNumberAttributeDefinition();
		cover.setName("canopy_cover");
		cover.setType(Type.REAL);
		plotDefinition.addChildDefinition(cover);

		TimeAttributeDefinition time = schema.createTimeAttributeDefinition();
		time.setName("survey_time");
		plotDefinition.addChildDefinition(time);

		CoordinateAttributeDefinition location = schema.createCoordinateAttributeDefinition();
		location.setName("location");
		plotDefinition.addChildDefinition(location);

		// As RecordManager.create does in Collect Earth : with the empty attributes that the balloon values go into
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

	private Integer year() {
		IntegerAttribute attribute = (IntegerAttribute) plot.getChild("imagery_year_used");
		return attribute == null ? null : attribute.getValue().getValue();
	}

	private Double cover() {
		RealAttribute attribute = (RealAttribute) plot.getChild("canopy_cover");
		return attribute == null ? null : attribute.getValue().getValue();
	}

	@Test
	void aMistypedWholeNumberIsReportedOnItsFieldAndKeepsTheValueItHad() {
		assertTrue(save(YEAR, "2023").isEmpty());
		assertEquals(2023, year());

		Map<String, String> invalidValues = save(YEAR, "07/2024");

		assertEquals(1, invalidValues.size());
		assertTrue(invalidValues.containsKey(YEAR), "Reported under the name of the field in the balloon");
		assertEquals(2023, year());
	}

	@Test
	void aMistypedNumberNoLongerErasesTheValueItHad() {
		save(COVER, "12,5");
		assertEquals(12.5, cover());

		Map<String, String> invalidValues = save(COVER, "12,5%");

		assertTrue(invalidValues.containsKey(COVER));
		assertEquals(12.5, cover(), "It used to be set to nothing, without a word");
	}

	@Test
	void aMistypedTimeIsReportedOnItsField() {
		assertTrue(save(TIME, "half past two").containsKey(TIME));
	}

	// The coordinate is filled by the balloon, not typed : the interpreter could do nothing about an error on it
	@Test
	void aCoordinateThatCannotBeReadIsNotReportedOnTheField() {
		assertTrue(save(LOCATION, "plot_473").isEmpty());
	}

	@Test
	void savingWithoutAskingForTheInvalidValuesStillWorks() {
		Map<String, String> parameters = new HashMap<>();
		parameters.put(YEAR, "07/2024");

		balloonInputFieldsUtils.saveToEntity(parameters, plot, false);

		assertNull(year());
	}

	@Test
	void theHandlersRejectWhatTheyCannotRead() {
		assertThrows(NumberFormatException.class, () -> new IntegerAttributeHandler().createValue("07/2024"));
		assertThrows(NumberFormatException.class, () -> new RealAttributeHandler().createValue("12,5%"));
		assertThrows(IllegalArgumentException.class, () -> new TimeAttributeHandler().createValue("half past two"));

		assertEquals(2024, new IntegerAttributeHandler().createValue("2024").getValue());
		assertEquals(12.5, new RealAttributeHandler().createValue("12,5").getValue(), "A decimal comma is still accepted");
	}

	@Test
	void onlyTheValuesTheInterpreterTypesAreReportedOnTheirField() {
		assertTrue(BalloonInputFieldsUtils.isTypedByInterpreter(new IntegerAttributeHandler()));
		assertTrue(BalloonInputFieldsUtils.isTypedByInterpreter(new RealAttributeHandler()));
		assertTrue(BalloonInputFieldsUtils.isTypedByInterpreter(new TimeAttributeHandler()));
		assertFalse(BalloonInputFieldsUtils.isTypedByInterpreter(new CoordinateAttributeHandler()));
		assertFalse(BalloonInputFieldsUtils.isTypedByInterpreter(new DateAttributeHandler()));
	}
}

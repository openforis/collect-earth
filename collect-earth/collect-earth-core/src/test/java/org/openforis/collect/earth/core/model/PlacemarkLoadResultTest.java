package org.openforis.collect.earth.core.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

class PlacemarkLoadResultTest {

	private static final String YEAR = "collect_integer_imagery_year_used";

	// A partial update only returns the fields that changed, and a value that could not be read changed nothing
	@Test
	void anInvalidValueOnAFieldThatIsNotInTheResultIsShownNotHidden() {
		PlacemarkLoadResult result = new PlacemarkLoadResult();
		result.setInputFieldInfoByParameterName(new LinkedHashMap<>());

		result.setInvalidValue(YEAR, "'07/2024' is not a whole number");

		PlacemarkInputFieldInfo info = result.getInputFieldInfoByParameterName().get(YEAR);
		assertTrue(info.isVisible(), "The balloon hides a field whose info says it is not visible");
		assertTrue(info.isInError());
		assertEquals("'07/2024' is not a whole number", info.getErrorMessage());
		assertFalse(result.isValidData());
	}

	@Test
	void anInvalidValueOnAFieldAlreadyInTheResultKeepsItsRelevance() {
		PlacemarkInputFieldInfo notRelevant = new PlacemarkInputFieldInfo();
		notRelevant.setVisible(false);
		Map<String, PlacemarkInputFieldInfo> infos = new LinkedHashMap<>();
		infos.put(YEAR, notRelevant);
		PlacemarkLoadResult result = new PlacemarkLoadResult();
		result.setInputFieldInfoByParameterName(infos);

		result.setInvalidValue(YEAR, "'07/2024' is not a whole number");

		assertFalse(result.getInputFieldInfoByParameterName().get(YEAR).isVisible());
		assertTrue(result.getInputFieldInfoByParameterName().get(YEAR).isInError());
	}
}

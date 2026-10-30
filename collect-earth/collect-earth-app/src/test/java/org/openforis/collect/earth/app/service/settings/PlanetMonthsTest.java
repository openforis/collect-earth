package org.openforis.collect.earth.app.service.settings;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.LocalDate;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.settings.PlanetMonths.Month;

/** The Tropical Forest Observatory mosaics offered, as PlanetMonthlyObject listed them. */
public class PlanetMonthsTest {

	@Test
	public void biannualMosaicsThenMonthlyOnesUpToTheMonthBefore() {
		List<Month> months = PlanetMonths.available(LocalDate.of(2021, 3, 15));
		assertEquals("2015-12_2016-05", months.get(0).getValue());
		assertEquals("2015/12 - 2016/05", months.get(0).getLabel());
		assertEquals("2020-06_2020-08", months.get(9).getValue());
		assertEquals("2020-09", months.get(10).getValue());
		assertEquals("2020/09", months.get(10).getLabel());
		assertEquals("2021-02", months.get(months.size() - 1).getValue());
		assertEquals(10 + 6, months.size());
	}

	@Test
	public void theLastMonthIsOutOnlyFromTheTenth() {
		List<Month> months = PlanetMonths.available(LocalDate.of(2021, 3, 9));
		assertEquals("2021-01", months.get(months.size() - 1).getValue());
		// December of a completed year is listed
		List<Month> january = PlanetMonths.available(LocalDate.of(2022, 1, 20));
		assertEquals("2021-12", january.get(january.size() - 1).getValue());
	}
}

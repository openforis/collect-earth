package org.openforis.collect.earth.app.service.settings;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

/**
 * The mosaics of Planet's Tropical Forest Observatory the user can choose as the first and last of the comparison:
 * biannual until 2020-08, monthly from 2020-09 to the month before the current one, which is only published around
 * the 10th (what PlanetMonthlyObject.getPlanetMonthlyMosaics listed for the Swing dialog).
 */
public final class PlanetMonths {

	/** A mosaic: its value as stored (2019-12_2020-05, 2021-03) and its label (2019/12 - 2020/05, 2021/03). */
	public static final class Month {
		private final String value;
		private final String label;

		Month(String value, String label) {
			this.value = value;
			this.label = label;
		}

		public String getValue() {
			return value;
		}

		public String getLabel() {
			return label;
		}
	}

	private static final YearMonth FIRST_MONTHLY = YearMonth.of(2020, 9);
	/** Before this day of the month the mosaic of the previous month is not out yet */
	private static final int PUBLISHED_ON_DAY = 10;

	private PlanetMonths() {
	}

	public static List<Month> available(LocalDate today) {
		List<Month> months = new ArrayList<>();
		biannual(months, 2015, 12, 2016, 5);
		biannual(months, 2016, 6, 2016, 11);
		biannual(months, 2016, 12, 2017, 5);
		biannual(months, 2017, 6, 2017, 11);
		biannual(months, 2017, 12, 2018, 5);
		biannual(months, 2018, 6, 2018, 11);
		biannual(months, 2018, 12, 2019, 5);
		biannual(months, 2019, 6, 2019, 11);
		biannual(months, 2019, 12, 2020, 5);
		biannual(months, 2020, 6, 2020, 8);
		YearMonth last = YearMonth.from(today).minusMonths(today.getDayOfMonth() < PUBLISHED_ON_DAY ? 2 : 1);
		for (YearMonth month = FIRST_MONTHLY; !month.isAfter(last); month = month.plusMonths(1)) {
			months.add(new Month(month.toString(), month.getYear() + "/" + two(month.getMonthValue())));
		}
		return months;
	}

	private static void biannual(List<Month> months, int fromYear, int fromMonth, int toYear, int toMonth) {
		months.add(new Month(fromYear + "-" + two(fromMonth) + "_" + toYear + "-" + two(toMonth),
				fromYear + "/" + two(fromMonth) + " - " + toYear + "/" + two(toMonth)));
	}

	private static String two(int month) {
		return month < 10 ? "0" + month : String.valueOf(month);
	}
}

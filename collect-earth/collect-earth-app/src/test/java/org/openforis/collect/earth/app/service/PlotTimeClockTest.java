package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.PlotTimeService.Clock;

/** The rule that counts the active time spent on a plot (PlotTimeService). */
public class PlotTimeClockTest {

	private static final long MINUTE = 60_000L;

	@Test
	public void opening_a_plot_adds_nothing_and_its_saves_add_the_time_since_the_last_sign_of_work() {
		Clock clock = new Clock(5 * MINUTE);
		assertEquals(0, clock.work("1", 0));
		assertEquals(40_000, clock.work("1", 40_000));
		assertEquals(2 * MINUTE, clock.work("1", 40_000 + 2 * MINUTE));
	}

	@Test
	public void a_pause_longer_than_the_idle_limit_adds_nothing_and_the_count_goes_on_after_it() {
		Clock clock = new Clock(5 * MINUTE);
		clock.work("1", 0);
		assertEquals(0, clock.work("1", 30 * MINUTE));
		assertEquals(MINUTE, clock.work("1", 31 * MINUTE));
		// exactly the limit still counts
		assertEquals(5 * MINUTE, clock.work("1", 36 * MINUTE));
	}

	@Test
	public void work_on_another_plot_ends_the_stretch_so_no_minute_counts_twice() {
		Clock clock = new Clock(5 * MINUTE);
		clock.work("1", 0);
		assertEquals(0, clock.work("2", MINUTE));
		assertEquals(MINUTE, clock.work("2", 2 * MINUTE));
		// back on plot 1: the time spent on plot 2 is not plot 1's
		assertEquals(0, clock.work("1", 3 * MINUTE));
		assertEquals(30_000, clock.work("1", 3 * MINUTE + 30_000));
	}

	@Test
	public void a_clock_going_back_adds_nothing() {
		Clock clock = new Clock(5 * MINUTE);
		clock.work("1", 10 * MINUTE);
		assertEquals(0, clock.work("1", 9 * MINUTE));
		assertEquals(MINUTE, clock.work("1", 10 * MINUTE));
	}

	@Test
	public void plots_with_several_keys_are_told_apart() {
		Clock clock = new Clock(5 * MINUTE);
		clock.work("7,1", 0);
		assertEquals(0, clock.work("7,2", MINUTE));
	}
}

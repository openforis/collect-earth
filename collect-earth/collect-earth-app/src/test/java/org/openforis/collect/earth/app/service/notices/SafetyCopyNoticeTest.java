package org.openforis.collect.earth.app.service.notices;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.SafetyCopy;

/** The notice that says where a safety copy is: the first start's, or the one taken before a join */
public class SafetyCopyNoticeTest {

	@Test
	public void saysWhereTheCopyIsAndWhatItHolds() {
		assertNull(SafetyCopyNotice.noticeOf(null));
		Notice first = SafetyCopyNotice.noticeOf(new String[] { SafetyCopy.FIRST_START, "/data/safetyCopies/before-collect-earth-2.zip", "" });
		assertEquals(SafetyCopyNotice.KIND, first.getKind());
		assertTrue(message(first).contains("/data/safetyCopies/before-collect-earth-2.zip"));
		assertTrue(message(first).contains("Collect Earth 1"));
		Notice join = SafetyCopyNotice.noticeOf(new String[] { SafetyCopy.BEFORE_JOIN, "/data/safetyCopies/before-joining-x.zip", "collect_earth_initial_2025" });
		assertTrue(message(join).contains("/data/safetyCopies/before-joining-x.zip"));
		assertTrue(message(join).contains("collect_earth_initial_2025"));
		// MessageFormat's quotes: "project's" written once, not "project''s"
		assertTrue(message(join).contains("project's"), message(join));
	}

	private static String message(Notice notice) {
		return String.valueOf(notice.toJson("n1").get("message"));
	}
}

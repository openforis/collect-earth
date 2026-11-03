package org.openforis.collect.earth.app.service.notices;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

public class NoticeServiceTest {

	private final NoticeService service = new NoticeService();

	@Test
	@SuppressWarnings("unchecked")
	public void noticesAreListedOldestFirstWithTheirOptions() {
		String first = service.post(new Notice("update", Notice.INFO, "Update", "A new version").option("later", "Later").option("now", "Now"));
		String second = service.post(new Notice("error", Notice.ERROR, "Error", "Boom"));
		List<Map<String, Object>> pending = service.pending();
		assertEquals(2, pending.size());
		assertEquals(first, pending.get(0).get("id"));
		assertEquals("update", pending.get(0).get("kind"));
		assertEquals(false, pending.get(0).get("html"));
		List<Map<String, String>> options = (List<Map<String, String>>) pending.get(0).get("options");
		assertEquals("later", options.get(0).get("id"));
		assertEquals("Now", options.get(1).get("label"));
		// A notice without options gets Ok
		assertEquals(second, pending.get(1).get("id"));
		options = (List<Map<String, String>>) pending.get(1).get("options");
		assertEquals(1, options.size());
		assertEquals("ok", options.get(0).get("id"));
		assertTrue(service.hasPending("error"));
		assertFalse(service.hasPending("announcement"));
	}

	@Test
	public void answeringRunsTheOptionOnceAndTakesTheNoticeOut() {
		List<String> answers = new ArrayList<>();
		String id = service.post(new Notice("update", Notice.INFO, "Update", "A new version").option("later", "Later"), answers::add);
		assertTrue(service.answer(id, "later"));
		assertEquals(List.of("later"), answers);
		assertTrue(service.pending().isEmpty());
		// Answered already, by another page
		assertFalse(service.answer(id, "later"));
		assertEquals(1, answers.size());
		assertFalse(service.answer("n99", "ok"));
	}

	@Test
	public void anAnnouncementIsHtml() {
		service.post(new Notice("announcement", Notice.WARNING, "Maintenance", "<p>Tonight</p>").html());
		assertEquals(true, service.pending().get(0).get("html"));
	}
}

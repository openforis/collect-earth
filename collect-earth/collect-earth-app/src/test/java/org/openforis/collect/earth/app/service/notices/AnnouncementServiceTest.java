package org.openforis.collect.earth.app.service.notices;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

public class AnnouncementServiceTest {

	@TempDir
	File folder;

	private final NoticeService notices = new NoticeService();

	private static String json(String... items) {
		return "[" + String.join(",", items) + "]";
	}

	private static String item(String id, String severity, String start, String end) {
		return "{\"id\":\"" + id + "\",\"title\":\"Title " + id + "\",\"message\":\"<p>Message</p>\",\"severity\":\"" + severity
				+ "\",\"start_date\":\"" + start + "\",\"end_date\":\"" + end + "\"}";
	}

	@Test
	public void theAnnouncementsValidTodayAndNotShownYetAreNoticesCriticalFirst() throws Exception {
		File shown = new File(folder, "shown.txt");
		Files.write(shown.toPath(), List.of("old"), StandardCharsets.UTF_8);
		String today = LocalDate.now().toString();
		String yesterday = LocalDate.now().minusDays(1).toString();
		String lastMonth = LocalDate.now().minusDays(40).toString();
		AnnouncementService service = new AnnouncementService(notices, () -> json(
				item("old", "info", lastMonth, today),
				item("maintenance", "warning", today, today),
				item("down", "critical", lastMonth, today),
				item("over", "info", lastMonth, yesterday),
				item("typo", "info", "2026-13-45", ""),
				"null"), shown);
		service.check();
		List<Map<String, Object>> pending = notices.pending();
		assertEquals(2, pending.size());
		assertEquals("Title down", pending.get(0).get("title"));
		assertEquals("error", pending.get(0).get("severity"));
		assertEquals(true, pending.get(0).get("html"));
		assertEquals("Title maintenance", pending.get(1).get("title"));
		assertEquals("warning", pending.get(1).get("severity"));
		// Answered: shown from now on
		notices.answer((String) pending.get(0).get("id"), "ok");
		assertEquals(List.of("old", "down"), Files.readAllLines(shown.toPath()));
		notices.answer((String) pending.get(1).get("id"), "ok");
		service.check();
		assertTrue(notices.pending().isEmpty());
	}

	@Test
	public void aServerThatCannotBeReachedPostsNothing() {
		AnnouncementService service = new AnnouncementService(notices, () -> {
			throw new java.io.IOException("timeout");
		}, new File(folder, "shown.txt"));
		service.check();
		assertTrue(notices.pending().isEmpty());
	}

	@Test
	public void anAnnouncementWithoutDatesIsAlwaysValid() {
		AnnouncementService.Announcement a = new AnnouncementService.Announcement("a", "t", "m", null, null, "");
		assertTrue(a.isValidOn(LocalDate.now()));
		assertEquals("info", a.severity());
	}
}

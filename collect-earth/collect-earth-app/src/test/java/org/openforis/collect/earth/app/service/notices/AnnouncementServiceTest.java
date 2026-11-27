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
				"null"), shown, () -> "2.0.0");
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
		}, new File(folder, "shown.txt"), () -> "2.0.0");
		service.check();
		assertTrue(notices.pending().isEmpty());
	}

	@Test
	public void anAnnouncementWithoutDatesIsAlwaysValid() {
		AnnouncementService.Announcement a = new AnnouncementService.Announcement("a", "t", "m", null, null, "");
		assertTrue(a.isValidOn(LocalDate.now()));
		assertEquals("info", a.severity());
	}

	private static String forVersions(String id, String min, String max) {
		String today = LocalDate.now().toString();
		return "{\"id\":\"" + id + "\",\"title\":\"Title " + id + "\",\"message\":\"m\",\"severity\":\"info\",\"start_date\":\"" + today
				+ "\",\"end_date\":\"" + today + "\"" + (min == null ? "" : ",\"min_version\":\"" + min + "\"")
				+ (max == null ? "" : ",\"max_version\":\"" + max + "\"") + "}";
	}

	private List<String> shownTo(String version, String json) {
		NoticeService own = new NoticeService();
		new AnnouncementService(own, () -> json, new File(folder, "shown-" + version + ".txt"), () -> version).check();
		return own.pending().stream().map((n) -> (String) n.get("title")).sorted().toList();
	}

	@Test
	public void anAnnouncementForCollectEarth1IsNotShownToCollectEarth2() {
		String file = json(
				forVersions("ce1", null, "1.99"),
				forVersions("ce2", "2.0", null),
				forVersions("everyone", null, null),
				forVersions("ce2.1only", "2.1", "2.1.99"),
				forVersions("typo", "two", null));
		assertEquals(List.of("Title ce1", "Title everyone"), shownTo("1.23.19", file));
		assertEquals(List.of("Title ce2", "Title everyone"), shownTo("2.0.0", file));
		assertEquals(List.of("Title ce2", "Title everyone"), shownTo("2.0-beta", file));
		assertEquals(List.of("Title ce2", "Title ce2.1only", "Title everyone"), shownTo("2.1.3", file));
		assertEquals(List.of("Title ce2", "Title everyone"), shownTo("2.2", file));
	}

	@Test
	public void aVersionThatCannotBeReadIsTakenAsCollectEarth2() {
		String file = json(forVersions("ce1", null, "1.99"), forVersions("ce2", "2.0", null));
		assertEquals(List.of("Title ce2"), shownTo("unknown", file));
		assertEquals(List.of("Title ce2"), shownTo("", file));
		NoticeService own = new NoticeService();
		new AnnouncementService(own, () -> file, new File(folder, "shown-x.txt"), () -> {
			throw new IllegalStateException("no update.ini");
		}).check();
		assertEquals(1, own.pending().size());
	}

	@Test
	public void versionsAreComparedNumberByNumber() {
		assertEquals(List.of(1, 23, 19), toList(AnnouncementService.versionOf("1.23.19 major")));
		assertEquals(List.of(2, 0), toList(AnnouncementService.versionOf("2.0-beta")));
		assertEquals(null, AnnouncementService.versionOf("beta"));
		assertTrue(AnnouncementService.compareVersions(AnnouncementService.versionOf("1.23.19"), AnnouncementService.versionOf("1.99")) < 0);
		assertTrue(AnnouncementService.compareVersions(AnnouncementService.versionOf("1.99"), AnnouncementService.versionOf("2.0")) < 0);
		assertEquals(0, AnnouncementService.compareVersions(AnnouncementService.versionOf("2"), AnnouncementService.versionOf("2.0.0")));
		assertTrue(AnnouncementService.compareVersions(AnnouncementService.versionOf("2.10"), AnnouncementService.versionOf("2.9")) > 0);
	}

	private static List<Integer> toList(int[] v) {
		return v == null ? null : java.util.Arrays.stream(v).boxed().toList();
	}
}

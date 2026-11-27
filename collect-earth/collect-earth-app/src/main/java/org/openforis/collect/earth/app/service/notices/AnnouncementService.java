package org.openforis.collect.earth.app.service.notices;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.function.Supplier;

import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.UpdateIniUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * The announcements of the Open Foris server (announcements.json), as notices of the pages: what AnnouncementManager
 * showed in dialogs. Each is shown once: the ids answered are kept in a file of the data folder.
 * <p>
 * The file is read by every version of Collect Earth. An announcement may say which versions it is for, with
 * {@code min_version} and {@code max_version} (both included, either one alone, compared number by number: "1.99" is
 * after "1.23.19" and before "2.0"); one without them is for every version, as before. So the announcements written
 * for Collect Earth 1 ({@code "max_version": "1.99"}) are not shown to a new Collect Earth 2 installation, which has
 * never shown any and would otherwise show them all at its first start. A version that cannot be read keeps the
 * announcement off, as a date that cannot be read does.
 */
@Component
public class AnnouncementService {

	static final String ANNOUNCEMENTS_URL = "https://www.openforis.org/fileadmin/installer/announcements.json";
	static final String SHOWN_FILE = "shown_announcements.txt";

	private final Logger logger = LoggerFactory.getLogger(AnnouncementService.class);
	private final NoticeService notices;
	private final Callable<String> fetch;
	private final File shownFile;
	/** The version installed, as update.ini says it ("2.0.0", "2.0-beta"); read when the announcements are */
	private final Supplier<String> installedVersion;

	/**
	 * The version taken when the one installed cannot be read (running from the IDE, update.ini missing): this code
	 * ships from Collect Earth 2 on.
	 */
	static final String VERSION_WHEN_UNKNOWN = "2.0.0";

	@Autowired
	public AnnouncementService(NoticeService notices) {
		this(notices, () -> fetch(ANNOUNCEMENTS_URL), new File(FolderFinder.getCollectEarthDataFolder(), SHOWN_FILE),
				UpdateIniUtils::getVersionNameInstalled);
	}

	/** For the tests: the JSON from anywhere, the file of the ids shown wherever, the version installed given */
	AnnouncementService(NoticeService notices, Callable<String> fetch, File shownFile, Supplier<String> installedVersion) {
		this.notices = notices;
		this.fetch = fetch;
		this.shownFile = shownFile;
		this.installedVersion = installedVersion;
	}

	/** Fetches the announcements and posts the ones valid today and not shown yet. */
	public void check() {
		String json;
		try {
			json = fetch.call();
		} catch (Exception e) {
			// Once, and at warn: an announcement that cannot be fetched is a network condition, not a defect
			logger.warn("The announcements could not be fetched : {}", e.getMessage());
			return;
		}
		Set<String> shown = loadShown();
		int[] version = installed();
		for (Announcement a : parse(json)) {
			if (!shown.contains(a.id) && a.isValidOn(LocalDate.now()) && a.isFor(version)) {
				notices.post(new Notice("announcement", a.severity(), a.title, a.message).html(), option -> markShown(a.id));
			}
		}
	}

	/** The version installed, as numbers; VERSION_WHEN_UNKNOWN when it cannot be read */
	private int[] installed() {
		String name;
		try {
			name = installedVersion.get();
		} catch (RuntimeException e) {
			name = null;
		}
		int[] version = versionOf(name);
		return version != null ? version : versionOf(VERSION_WHEN_UNKNOWN);
	}

	/**
	 * The numbers a version starts with, up to the first part that is not one: "2.0.0" is 2, 0, 0; "2.0-beta" is 2, 0;
	 * "1.23.19 major" is 1, 23, 19. Null for none ("unknown", empty).
	 */
	static int[] versionOf(String text) {
		if (text == null) {
			return null;
		}
		java.util.regex.Matcher m = java.util.regex.Pattern.compile("^\\s*(\\d+(?:\\.\\d+)*)").matcher(text);
		if (!m.find()) {
			return null;
		}
		String[] parts = m.group(1).split("\\.");
		int[] numbers = new int[parts.length];
		try {
			for (int i = 0; i < parts.length; i++) {
				numbers[i] = Integer.parseInt(parts[i]);
			}
		} catch (NumberFormatException e) {
			return null;
		}
		return numbers;
	}

	/** Compares two versions number by number, a missing number being 0 ("2" is "2.0.0") */
	static int compareVersions(int[] a, int[] b) {
		for (int i = 0; i < Math.max(a.length, b.length); i++) {
			int x = i < a.length ? a[i] : 0;
			int y = i < b.length ? b[i] : 0;
			if (x != y) {
				return Integer.compare(x, y);
			}
		}
		return 0;
	}

	private static String fetch(String url) throws IOException {
		HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
		connection.setRequestMethod("GET");
		connection.setConnectTimeout(5000);
		connection.setReadTimeout(5000);
		try (BufferedReader in = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
			StringBuilder response = new StringBuilder();
			String line;
			while ((line = in.readLine()) != null) {
				response.append(line);
			}
			return response.toString();
		} finally {
			connection.disconnect();
		}
	}

	/** The announcements of the JSON, the ones that cannot be read left out, by severity (critical first) */
	List<Announcement> parse(String json) {
		List<Announcement> announcements = new ArrayList<>();
		JsonArray array = JsonParser.parseString(json).getAsJsonArray();
		for (JsonElement element : array) {
			try {
				if (element != null && !element.isJsonNull()) {
					JsonObject obj = element.getAsJsonObject();
					Announcement a = new Announcement(obj.get("id").getAsString(), obj.get("title").getAsString(),
							obj.get("message").getAsString(), obj.get("severity").getAsString(),
							text(obj, "start_date"), text(obj, "end_date"));
					a.versions(text(obj, "min_version"), text(obj, "max_version"));
					announcements.add(a);
				}
			} catch (RuntimeException e) {
				logger.warn("Error reading the announcement {}", element, e);
			}
		}
		Collections.sort(announcements, Comparator.comparing(a -> a.severityWord));
		return announcements;
	}

	private static String text(JsonObject obj, String name) {
		JsonElement e = obj.get(name);
		return e == null || e.isJsonNull() ? null : e.getAsString();
	}

	private Set<String> loadShown() {
		Set<String> shown = new LinkedHashSet<>();
		if (shownFile.exists()) {
			try {
				for (String line : Files.readAllLines(shownFile.toPath(), StandardCharsets.UTF_8)) {
					if (!line.trim().isEmpty()) {
						shown.add(line.trim());
					}
				}
			} catch (IOException e) {
				logger.error("Error loading the announcements that were already shown", e);
			}
		}
		return shown;
	}

	private synchronized void markShown(String id) {
		Set<String> shown = loadShown();
		shown.add(id);
		try {
			Files.write(shownFile.toPath(), shown, StandardCharsets.UTF_8);
		} catch (IOException e) {
			logger.error("Error saving the announcements that were already shown", e);
		}
	}

	static class Announcement {
		final String id;
		final String title;
		final String message;
		final String severityWord;
		private boolean datesMalformed;
		private final LocalDate start;
		private final LocalDate end;
		private boolean versionsMalformed;
		private int[] minVersion;
		private int[] maxVersion;

		Announcement(String id, String title, String message, String severity, String start, String end) {
			this.id = id;
			this.title = title;
			this.message = message;
			this.severityWord = severity == null ? "info" : severity;
			this.start = parseDate(start);
			this.end = parseDate(end);
		}

		String severity() {
			if ("critical".equalsIgnoreCase(severityWord)) {
				return Notice.ERROR;
			}
			return "warning".equalsIgnoreCase(severityWord) ? Notice.WARNING : Notice.INFO;
		}

		/** The versions it is for (min_version, max_version, both included); none given, every version */
		Announcement versions(String min, String max) {
			minVersion = version(min);
			maxVersion = version(max);
			return this;
		}

		private int[] version(String text) {
			if (text == null || text.trim().isEmpty()) {
				return null;
			}
			int[] v = versionOf(text);
			if (v == null) {
				versionsMalformed = true;
			}
			return v;
		}

		/** Whether it is for this version; a version of the file that cannot be read keeps it off */
		boolean isFor(int[] version) {
			if (versionsMalformed) {
				return false;
			}
			return (minVersion == null || compareVersions(version, minVersion) >= 0)
					&& (maxVersion == null || compareVersions(version, maxVersion) <= 0);
		}

		/** The end date includes the whole of its day; a date that cannot be read keeps the announcement off */
		boolean isValidOn(LocalDate day) {
			if (datesMalformed) {
				return false;
			}
			return (start == null || !day.isBefore(start)) && (end == null || !day.isAfter(end));
		}

		private LocalDate parseDate(String text) {
			if (text == null || text.trim().isEmpty()) {
				return null;
			}
			try {
				return LocalDate.parse(text.trim());
			} catch (RuntimeException e) {
				datesMalformed = true;
				return null;
			}
		}
	}
}

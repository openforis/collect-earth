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

import org.openforis.collect.earth.app.service.FolderFinder;
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
 */
@Component
public class AnnouncementService {

	static final String ANNOUNCEMENTS_URL = "https://www.openforis.org/fileadmin/installer/announcements.json";
	static final String SHOWN_FILE = "shown_announcements.txt";

	private final Logger logger = LoggerFactory.getLogger(AnnouncementService.class);
	private final NoticeService notices;
	private final Callable<String> fetch;
	private final File shownFile;

	@Autowired
	public AnnouncementService(NoticeService notices) {
		this(notices, () -> fetch(ANNOUNCEMENTS_URL), new File(FolderFinder.getCollectEarthDataFolder(), SHOWN_FILE));
	}

	/** For the tests: the JSON from anywhere, the file of the ids shown wherever */
	AnnouncementService(NoticeService notices, Callable<String> fetch, File shownFile) {
		this.notices = notices;
		this.fetch = fetch;
		this.shownFile = shownFile;
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
		for (Announcement a : parse(json)) {
			if (!shown.contains(a.id) && a.isValidOn(LocalDate.now())) {
				notices.post(new Notice("announcement", a.severity(), a.title, a.message).html(), option -> markShown(a.id));
			}
		}
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
					announcements.add(new Announcement(obj.get("id").getAsString(), obj.get("title").getAsString(),
							obj.get("message").getAsString(), obj.get("severity").getAsString(),
							text(obj, "start_date"), text(obj, "end_date")));
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

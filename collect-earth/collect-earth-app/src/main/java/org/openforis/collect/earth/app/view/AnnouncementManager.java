package org.openforis.collect.earth.app.view;

import org.openforis.collect.earth.app.service.FolderFinder;
import java.time.ZoneId;
import java.time.LocalDate;
import javax.swing.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.*;
import com.google.gson.*; // Include a JSON library like Gson or Jackson

public class AnnouncementManager {

    private static final String ANNOUNCEMENTS_URL = "https://www.openforis.org/fileadmin/installer/announcements.json";
    /**
     * Kept in the data folder of the user : this used to resolve against the folder the process was started in, which under a
     * normal Windows installation is not writable, so the save failed silently and every announcement came back on each start
     */
    private static final String SHOWN_ANNOUNCEMENTS_FILE = FolderFinder.getCollectEarthDataFolder() + File.separator
            + "shown_announcements.txt";
    private final Set<String> shownAnnouncements = new HashSet<>();
    private static Logger logger = LoggerFactory.getLogger(AnnouncementManager.class);

    public AnnouncementManager() {
        loadShownAnnouncements();
    }

    public void checkAnnouncements() {
        try {
            String jsonResponse = fetchFromServer(ANNOUNCEMENTS_URL);
            List<Announcement> announcements = parseAnnouncements(jsonResponse);
            displayAnnouncementsInDialog(announcements);
        } catch (Exception e) {
            // Once, and at warn. The Sentry appender is bound at ERROR, and an announcement that cannot be fetched
            // is a network condition rather than a defect: nothing an interpreter reads changes because of it. The
            // same failure used to be logged three times, twice at ERROR, which put it among the most frequent
            // errors reported.
            logger.warn("The announcements could not be fetched from {} : {}", ANNOUNCEMENTS_URL, e.getMessage());
        }
    }

    private String fetchFromServer(String url) throws IOException {
        URL serverUrl = new URL(url);
        HttpURLConnection connection = (HttpURLConnection) serverUrl.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);

        try (BufferedReader in = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
            StringBuilder response = new StringBuilder();
            String inputLine;
            while ((inputLine = in.readLine()) != null) {
                response.append(inputLine);
            }
            return response.toString();
        } catch (IOException e) {
            // Not logged here : it is rethrown and the caller reports it. Logging both places reported one failure
            // twice, and this copy was at ERROR.
            throw e;
        } finally {
            connection.disconnect();
        }
    }

    private List<Announcement> parseAnnouncements(String jsonResponse) {
        List<Announcement> announcements = new ArrayList<>();
        JsonArray jsonArray = JsonParser.parseString(jsonResponse).getAsJsonArray();

        for (JsonElement element : jsonArray) {
        	try {
	        	if( element != null && !element.isJsonNull() ) {
						JsonObject obj = element.getAsJsonObject();
						Announcement announcement = new Announcement(
						        obj.get("id").getAsString(),
						        obj.get("title").getAsString(),
						        obj.get("message").getAsString(),
						        obj.get("severity").getAsString(),
						        obj.get("start_date").getAsString(),
						        obj.get("end_date").getAsString()
						);
						announcements.add(announcement);
	        	}
        	} catch (Exception e) {
        		logger.error("Error parsing announcement: " + e.getMessage(), e);
        		logger.warn("Error reading the announcement {}", element, e);
        	}
        }

        // Sort announcements by severity
        Collections.sort(announcements, new Comparator<Announcement>() {
            @Override
            public int compare(Announcement a1, Announcement a2) {
                return a1.getSeverity().compareTo(a2.getSeverity());
			}
        });

        return filterAnnouncements(announcements);
    }

    private List<Announcement> filterAnnouncements(List<Announcement> announcements) {
        List<Announcement> filtered = new ArrayList<>();
        Date now = new Date();

        for (Announcement announcement : announcements) {
            if (!shownAnnouncements.contains(announcement.getId())
                    && announcement.isValidForDate(now)) {
                filtered.add(announcement);
            }
        }
        return filtered;
    }

    private void displayAnnouncementsInDialog(List<Announcement> announcements) {
        if (announcements.isEmpty()) {
            return;
        }

        for (Announcement announcement : announcements) {
            String message = formatMessage(announcement);
            showAnnouncementDialog(message, announcement.getSeverity());
            markAnnouncementAsRead(announcement.getId());
        }
    }

    private String formatMessage(Announcement announcement) {
        return "<html><h2>" + announcement.getTitle() + "</h2><p>" +
               announcement.getMessage() + "</p></html>";
    }

    private void showAnnouncementDialog(String message, String severity) {
        // Built and shown on the event thread : this runs on the thread that fetched the announcements
        javax.swing.SwingUtilities.invokeLater( () -> buildAndShowAnnouncementDialog(message, severity) );
    }

    private void buildAndShowAnnouncementDialog(String message, String severity) {
        int messageType = JOptionPane.INFORMATION_MESSAGE; // Default to info
        if ("warning".equalsIgnoreCase(severity)) {
            messageType = JOptionPane.WARNING_MESSAGE;
        } else if ("critical".equalsIgnoreCase(severity)) {
            messageType = JOptionPane.ERROR_MESSAGE;
        }

        JTextPane textPane = new JTextPane();
        textPane.setContentType("text/html");
        textPane.setText(message);
        textPane.setEditable(false);

        JScrollPane scrollPane = new JScrollPane(textPane);
        scrollPane.setPreferredSize(new java.awt.Dimension(400, 300));

        JOptionPane.showMessageDialog(
                null,
                scrollPane,
                "Announcement",
                messageType
        );
    }

    private void markAnnouncementAsRead(String id) {
        shownAnnouncements.add(id);
        saveShownAnnouncements();
    }

    private void loadShownAnnouncements() {
        File file = new File(SHOWN_ANNOUNCEMENTS_FILE);
        if (file.exists()) {
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    shownAnnouncements.add(line.trim());
                }
            } catch (IOException e) {
                logger.error("Error loading the announcements that were already shown", e);
            }
        }
    }

    private void saveShownAnnouncements() {
        try (BufferedWriter writer = new BufferedWriter(new FileWriter(SHOWN_ANNOUNCEMENTS_FILE))) {
            for (String id : shownAnnouncements) {
                writer.write(id);
                writer.newLine();
            }
        } catch (IOException e) {
            logger.error("Error saving the announcements that were already shown", e);
        }
    }

    static class Announcement {
        private final String id;
        private final String title;
        private final String message;
        private final String severity;
        private boolean datesAreMalformed;
        private final LocalDate startDate;
        private final LocalDate endDate;

        public Announcement(String id, String title, String message, String severity, String startDate, String endDate) {
            this.id = id;
            this.title = title;
            this.message = message;
            this.severity = severity;
            // The dates are parsed after the id, its warning names it
            this.startDate = parseDate(startDate);
            this.endDate = parseDate(endDate);
        }

        public String getId() {
            return id;
        }

        public String getTitle() {
            return title;
        }

        public String getMessage() {
            return message;
        }

        public String getSeverity() {
            return severity;
        }

        public boolean isValidForDate(Date date) {
            if (datesAreMalformed) {
                // A mistyped date used to be read as "no limit", which left the announcement on screen for ever
                return false;
            }
            LocalDate day = date.toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
            // The end date includes the whole of its day : it used to be parsed as midnight, so the announcement disappeared
            // a day early
            return (startDate == null || !day.isBefore(startDate)) &&
                   (endDate == null || !day.isAfter(endDate));
        }

        private LocalDate parseDate(String dateStr) {
            if (dateStr == null || dateStr.trim().isEmpty()) {
                return null;
            }
            try {
                return LocalDate.parse(dateStr.trim());
            } catch (Exception e) {
                datesAreMalformed = true;
                logger.warn("The announcement {} has a date that cannot be read : {}", id, dateStr);
                return null;
            }
        }
    }

    public static void main(String[] args) {
        AnnouncementManager manager = new AnnouncementManager();
        manager.checkAnnouncements();
    }
}

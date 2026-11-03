package org.openforis.collect.earth.app.server.api;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;

import org.openforis.collect.earth.app.logging.NoticeAppender;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Help menu: the texts it shows in a dialog (the disclaimer in the UI language, the log) and whether the errors
 * logged are shown (the Show exception errors entry). The entries that open a file or a page are actions
 * (ActionsController).
 */
@RestController
public class HelpController {

	/** The folder the installer puts the disclaimers in, next to Collect Earth */
	static final String RESOURCES_FOLDER = "resources";
	static final String LOG_FILE = "earth_error.log";
	/** The end of the log that is shown: the file grows to megabytes, and the end is what says what just happened */
	static final int LOG_TAIL_BYTES = 200 * 1024;

	public static class ShownRequest {
		public boolean shown;
	}

	private final LocalPropertiesService properties;
	private final File resources;
	private final File dataFolder;

	@Autowired
	public HelpController(LocalPropertiesService properties) {
		this(properties, new File(RESOURCES_FOLDER), new File(FolderFinder.getCollectEarthDataFolder()));
	}

	HelpController(LocalPropertiesService properties, File resources, File dataFolder) {
		this.properties = properties;
		this.resources = resources;
		this.dataFolder = dataFolder;
	}

	/** @param name disclaimer or log */
	@GetMapping("/api/help/text")
	public Map<String, Object> text(@RequestParam("name") String name) throws IOException {
		File file;
		if ("disclaimer".equals(name)) {
			file = disclaimer();
			if (!file.exists()) {
				throw new ApiException(HttpStatus.NOT_FOUND, "help.missing", Messages.getString("CollectEarthWindow.8"));
			}
		} else if ("log".equals(name)) {
			file = new File(dataFolder, LOG_FILE);
			if (!file.exists()) {
				throw new ApiException(HttpStatus.NOT_FOUND, "help.missing", Messages.getString("HelpPage.noLog"));
			}
		} else {
			throw new ApiException(HttpStatus.NOT_FOUND, "help.unknown", "No text called " + name);
		}
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("path", file.getAbsolutePath());
		answer.put("text", "log".equals(name) ? tail(file) : new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
		return answer;
	}

	/** The disclaimer of the UI language, else the English one (CollectEarthMenu.getDisclaimerFilePath) */
	private File disclaimer() {
		String language = properties.getUiLanguage().getLocale().getLanguage();
		File localized = new File(resources, "disclaimer_" + language + ".txt");
		return localized.exists() ? localized : new File(resources, "disclaimer_en.txt");
	}

	private static String tail(File file) throws IOException {
		try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
			long length = raf.length();
			long from = Math.max(0, length - LOG_TAIL_BYTES);
			byte[] bytes = new byte[(int) (length - from)];
			raf.seek(from);
			raf.readFully(bytes);
			String text = new String(bytes, StandardCharsets.UTF_8);
			if (from > 0) {
				// From the first whole line
				int newline = text.indexOf('\n');
				text = newline < 0 ? text : text.substring(newline + 1);
			}
			return text;
		}
	}

	/** Show exception errors: the setting, and the appender that posts them from now on */
	@PutMapping("/api/help/errorsShown")
	public void errorsShown(@RequestBody ShownRequest request) {
		properties.setExceptionShown(request.shown);
		NoticeAppender appender = NoticeAppender.installed();
		if (appender != null) {
			appender.setShown(request.shown);
		}
	}
}

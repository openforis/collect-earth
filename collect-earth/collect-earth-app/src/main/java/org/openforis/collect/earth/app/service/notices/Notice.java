package org.openforis.collect.earth.app.service.notices;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.app.view.Messages;

/**
 * Something the server wants the pages to show, as the Swing window showed a dialog by itself: an announcement, the
 * offer of a new version, an error logged, a warning of the server's start, the cloud login. The page shows it with
 * its options as buttons, and answers with the option chosen (see NoticeService).
 */
public class Notice {

	public static final String INFO = "info";
	public static final String WARNING = "warning";
	public static final String ERROR = "error";

	/** The option a notice without options gets: the page's Ok */
	public static final String OK = "ok";

	private final String kind;
	private final String severity;
	private final String title;
	private final String message;
	private boolean html;
	private final List<Map<String, String>> options = new ArrayList<>();

	public Notice(String kind, String severity, String title, String message) {
		this.kind = kind;
		this.severity = severity;
		this.title = title;
		this.message = message;
	}

	/** The message is HTML (the announcements are written in it) rather than text. */
	public Notice html() {
		this.html = true;
		return this;
	}

	public Notice option(String id, String label) {
		Map<String, String> option = new LinkedHashMap<>();
		option.put("id", id);
		option.put("label", label);
		options.add(option);
		return this;
	}

	public String getKind() {
		return kind;
	}

	/** What the page receives, with the id it answers by */
	Map<String, Object> toJson(String id) {
		Map<String, Object> json = new LinkedHashMap<>();
		json.put("id", id);
		json.put("kind", kind);
		json.put("severity", severity);
		json.put("title", title);
		json.put("message", message);
		json.put("html", html);
		List<Map<String, String>> shown = options;
		if (shown.isEmpty()) {
			shown = Collections.singletonList(okOption());
		}
		json.put("options", shown);
		return json;
	}

	private static Map<String, String> okOption() {
		Map<String, String> ok = new LinkedHashMap<>();
		ok.put("id", OK);
		ok.put("label", Messages.getString("AboutDialog.8"));
		return ok;
	}
}

package org.openforis.collect.earth.app.server.api;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.app.service.NativeFileChooser;
import org.openforis.collect.earth.app.service.NativeFileChooser.BusyException;
import org.openforis.collect.earth.app.service.NativeFileChooser.Mode;
import org.openforis.collect.earth.app.service.NativeFileChooser.NoDisplayException;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * A path for a page: a browser can only hand a page the contents of a file, and Collect Earth needs where it is (a
 * project, a CSV of plots, a folder to export to). The server runs on the user's computer, so it shows the dialog.
 * <p>
 * Answers {@code {path}} or {@code {cancelled: true}}. Without a display there is nothing the page can do but say so:
 * 503 files.noDisplay. While another dialog is open: 409 files.busy, as the user has a dialog to answer first.
 */
@RestController
public class FilesController {

	private final NativeFileChooser chooser;

	@Autowired
	public FilesController(NativeFileChooser chooser) {
		this.chooser = chooser;
	}

	/** The fields a page leaves out take these values; an unknown mode is a bad request. */
	public static class Request {
		public Mode mode = Mode.OPEN;
		public List<String> extensions = Collections.emptyList();
		public String suggested;
	}

	@PostMapping("/api/files/choose")
	public Map<String, Object> choose(@RequestBody Request request) {
		// "mode": null and "extensions": null set the fields to null, over their defaults
		Mode mode = request.mode != null ? request.mode : Mode.OPEN;
		List<String> extensions = request.extensions != null ? request.extensions : Collections.emptyList();
		String path;
		try {
			path = chooser.choose(mode, extensions, request.suggested);
		} catch (NoDisplayException e) {
			throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "files.noDisplay",
					Messages.getString("FilesController.noDisplay"));
		} catch (BusyException e) {
			throw new ApiException(HttpStatus.CONFLICT, "files.busy", Messages.getString("FilesController.busy"));
		}
		return path == null ? Collections.singletonMap("cancelled", true) : Collections.singletonMap("path", path);
	}
}

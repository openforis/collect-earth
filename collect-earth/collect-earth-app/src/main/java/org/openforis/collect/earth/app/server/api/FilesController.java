package org.openforis.collect.earth.app.server.api;

import java.io.File;
import java.io.IOException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
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
 * Answers {@code {path}} ({@code {paths}} when several files were asked for) or {@code {cancelled: true}}. Without a
 * display there is nothing the page can do but say so: 503 files.noDisplay. While another dialog is open: 409
 * files.busy, as the user has a dialog to answer first.
 * <p>
 * It also opens a file the server wrote (an export) with the program of the system, or the folder it is in, for the
 * buttons of the job panel.
 */
@RestController
public class FilesController {

	/** Opens a file or a folder outside the browser */
	public interface Opener {
		void open(File file) throws IOException;
	}

	private final NativeFileChooser chooser;
	private final Opener openFile;
	private final Opener openFolder;

	@Autowired
	public FilesController(NativeFileChooser chooser) {
		this(chooser, file -> {
			if (!CollectEarthUtils.openFile(file)) {
				throw new IOException("No program opens " + file);
			}
		}, folder -> CollectEarthUtils.openFolderInExplorer(folder.getAbsolutePath()));
	}

	/** For the tests: how a file and a folder are opened. */
	FilesController(NativeFileChooser chooser, Opener openFile, Opener openFolder) {
		this.chooser = chooser;
		this.openFile = openFile;
		this.openFolder = openFolder;
	}

	/** The fields a page leaves out take these values; an unknown mode is a bad request. */
	public static class Request {
		public Mode mode = Mode.OPEN;
		public List<String> extensions = Collections.emptyList();
		public String suggested;
		/** Several files to open; only with the OPEN mode */
		public boolean multiple;
	}

	public static class PathRequest {
		public String path;
	}

	@PostMapping("/api/files/choose")
	public Map<String, Object> choose(@RequestBody Request request) {
		// "mode": null and "extensions": null set the fields to null, over their defaults
		Mode mode = request.mode != null ? request.mode : Mode.OPEN;
		List<String> extensions = request.extensions != null ? request.extensions : Collections.emptyList();
		try {
			if (request.multiple && mode == Mode.OPEN) {
				List<String> paths = chooser.chooseMany(extensions, request.suggested);
				return paths == null || paths.isEmpty() ? Collections.singletonMap("cancelled", true) : Collections.singletonMap("paths", paths);
			}
			String path = chooser.choose(mode, extensions, request.suggested);
			return path == null ? Collections.singletonMap("cancelled", true) : Collections.singletonMap("path", path);
		} catch (NoDisplayException e) {
			throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "files.noDisplay", Messages.getString("FilesController.noDisplay"));
		} catch (BusyException e) {
			throw new ApiException(HttpStatus.CONFLICT, "files.busy", Messages.getString("FilesController.busy"));
		}
	}

	/** Opens the file with the program of the system for its kind, as the Swing export did with a CSV or a KML. */
	@PostMapping("/api/files/open")
	public Map<String, Object> open(@RequestBody PathRequest request) throws IOException {
		File file = existing(request);
		openFile.open(file);
		return done(file);
	}

	/** Opens the folder of the file (or the folder itself) in the file explorer of the system. */
	@PostMapping("/api/files/reveal")
	public Map<String, Object> reveal(@RequestBody PathRequest request) throws IOException {
		File file = existing(request);
		File folder = file.isDirectory() ? file : file.getParentFile();
		openFolder.open(folder != null ? folder : file);
		return done(file);
	}

	private static File existing(PathRequest request) {
		File file = new File(StringUtils.trimToEmpty(request == null ? null : request.path));
		if (request == null || StringUtils.isBlank(request.path) || !file.exists()) {
			throw new ApiException(HttpStatus.NOT_FOUND, "files.missing", Messages.getString("FilesController.missing"));
		}
		return file;
	}

	private static Map<String, Object> done(File file) {
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("path", file.getAbsolutePath());
		return answer;
	}
}

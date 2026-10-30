package org.openforis.collect.earth.app.server.api;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.LinkedHashMap;
import java.util.Map;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.service.BackupSqlLiteService;
import org.openforis.collect.earth.app.service.QuitService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Quick actions of the menus and the pages, by name; the later stages add theirs (open the data folder, the log, the
 * manual...). An action that fails throws, and the handler answers the fault as for any call.
 */
@RestController
public class ActionsController {

	private final Map<String, Runnable> actions;

	@Autowired
	public ActionsController(QuitService quit, BackupSqlLiteService backup) {
		this(actions(quit, backup));
	}

	ActionsController(Map<String, Runnable> actions) {
		this.actions = actions;
	}

	private static Map<String, Runnable> actions(QuitService quit, BackupSqlLiteService backup) {
		Map<String, Runnable> actions = new LinkedHashMap<>();
		actions.put("quit", quit);
		// The Open backup folder button of the storage section of the settings
		actions.put("openBackupFolder", () -> {
			try {
				CollectEarthUtils.openFolderInExplorer(backup.getAutomaticBackUpFolder().getAbsolutePath());
			} catch (IOException e) {
				throw new UncheckedIOException(e);
			}
		});
		return actions;
	}

	/** Quitting answers before the server stops: QuitService does it on a thread of its own. */
	@PostMapping("/api/actions/{name}")
	public ResponseEntity<Void> action(@PathVariable("name") String name) {
		Runnable action = actions.get(name);
		if (action == null) {
			return ResponseEntity.notFound().build();
		}
		action.run();
		return ResponseEntity.ok().build();
	}
}

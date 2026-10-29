package org.openforis.collect.earth.app.server.api;

import org.openforis.collect.earth.app.service.QuitService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Quick actions of the menus; the later stages add theirs (open the data folder, the log, the manual...). */
@RestController
public class ActionsController {

	private final Runnable quit;

	@Autowired
	public ActionsController(QuitService quit) {
		this((Runnable) quit);
	}

	ActionsController(Runnable quit) {
		this.quit = quit;
	}

	/** Quitting answers before the server stops: QuitService does it on a thread of its own. */
	@PostMapping("/api/actions/{name}")
	public ResponseEntity<Void> action(@PathVariable("name") String name) {
		if ("quit".equals(name)) {
			quit.run();
			return ResponseEntity.ok().build();
		}
		return ResponseEntity.notFound().build();
	}
}

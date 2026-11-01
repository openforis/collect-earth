package org.openforis.collect.earth.app.server.api;

import java.util.Collections;
import java.util.Map;

import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** The notices the pages show and answer (see NoticeService). */
@RestController
public class NoticesController {

	public static class Answer {
		public String option;
	}

	private final NoticeService notices;

	@Autowired
	public NoticesController(NoticeService notices) {
		this.notices = notices;
	}

	@GetMapping("/api/notices")
	public Map<String, Object> notices() {
		return Collections.singletonMap("notices", notices.pending());
	}

	/** 404 for a notice answered already, by this page or another */
	@PostMapping("/api/notices/{id}/answer")
	public ResponseEntity<Void> answer(@PathVariable("id") String id, @RequestBody Answer answer) {
		return notices.answer(id, answer.option == null ? "ok" : answer.option) ? ResponseEntity.ok().build()
				: ResponseEntity.notFound().build();
	}
}

package org.openforis.collect.earth.app.server.api;

import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

/**
 * The errors of the API as {@code {error, message, details}}, which the pages show (api.ts): an ApiException is a
 * problem the user can act on, anything else a fault, logged (and so sent to Sentry, as every error of the log is).
 */
@ControllerAdvice(basePackageClasses = ApiExceptionHandler.class)
public class ApiExceptionHandler {

	private final Logger logger = LoggerFactory.getLogger(ApiExceptionHandler.class);

	@ExceptionHandler(ApiException.class)
	public ResponseEntity<Map<String, String>> expected(ApiException e) {
		return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body(e.getCode(), e.getMessage(), null));
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<Map<String, String>> unexpected(Exception e) {
		logger.error("The API failed", e);
		return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body("internal", null, e.getMessage()));
	}

	private static Map<String, String> body(String error, String message, String details) {
		Map<String, String> body = new LinkedHashMap<>();
		body.put("error", error);
		body.put("message", message);
		body.put("details", details);
		return body;
	}
}

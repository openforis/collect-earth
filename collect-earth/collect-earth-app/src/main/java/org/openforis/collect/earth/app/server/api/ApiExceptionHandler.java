package org.openforis.collect.earth.app.server.api;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.TypeMismatchException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.server.ResponseStatusException;

/**
 * The errors of the API as {@code {error, message, details}}, which the pages show (api.ts): an ApiException is a
 * problem the user can act on, a request Spring cannot make sense of a bad request, anything else a fault, logged (and
 * so sent to Sentry, as every error of the log is).
 * <p>
 * Only for the controllers of this package: the others fail as they always did.
 */
@ControllerAdvice(basePackageClasses = ApiExceptionHandler.class)
public class ApiExceptionHandler {

	private final Logger logger = LoggerFactory.getLogger(ApiExceptionHandler.class);

	@ExceptionHandler(ApiException.class)
	public ResponseEntity<Map<String, String>> expected(ApiException e) {
		return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body(e.getCode(), e.getMessage(), null));
	}

	/**
	 * The requests Spring rejects before or while calling the controller: malformed JSON, a parameter missing or of the
	 * wrong type (MethodArgumentTypeMismatchException, MissingServletRequestParameterException), a body that does not
	 * validate (MethodArgumentNotValidException), a content type that cannot be read. The handler for Exception would
	 * otherwise take them, as it runs before DefaultHandlerExceptionResolver, and report a fault of the page's as one of
	 * Collect Earth's.
	 */
	@ExceptionHandler({ HttpMessageNotReadableException.class, TypeMismatchException.class,
			ServletRequestBindingException.class, BindException.class, HttpMediaTypeNotSupportedException.class,
			MissingServletRequestPartException.class })
	public ResponseEntity<Map<String, String>> badRequest(Exception e) {
		logger.debug("The API was sent a request it cannot read", e);
		return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body("bad-request", e.getMessage(), null));
	}

	/** A controller that answers a status of its own, such as 404 for a plot that is not there. */
	@ExceptionHandler(ResponseStatusException.class)
	public ResponseEntity<Map<String, String>> withStatus(ResponseStatusException e) {
		String error = e.getStatus().name().toLowerCase(Locale.ENGLISH).replace('_', '-');
		return ResponseEntity.status(e.getStatus()).headers(e.getResponseHeaders())
				.body(body(error, e.getReason(), null));
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<Map<String, String>> unexpected(Exception e) {
		logger.error("The API failed", e);
		// the class says something when the exception has no message, as a NullPointerException often has not
		String details = e.getMessage() != null ? e.getMessage() : e.getClass().getName();
		return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body("internal", null, details));
	}

	private static Map<String, String> body(String error, String message, String details) {
		Map<String, String> body = new LinkedHashMap<>();
		body.put("error", error);
		body.put("message", message);
		body.put("details", details);
		return body;
	}
}

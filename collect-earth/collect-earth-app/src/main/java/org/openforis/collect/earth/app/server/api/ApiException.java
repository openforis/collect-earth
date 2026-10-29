package org.openforis.collect.earth.app.server.api;

import org.springframework.http.HttpStatus;

/**
 * A problem the user can do something about: answered with its code and message (see ApiExceptionHandler), and 400
 * unless it says another status, such as 409 for a job that is over already.
 */
public class ApiException extends RuntimeException {

	private static final long serialVersionUID = 1L;
	private final HttpStatus status;
	private final String code;

	public ApiException(String code, String message) {
		this(HttpStatus.BAD_REQUEST, code, message);
	}

	public ApiException(HttpStatus status, String code, String message) {
		super(message);
		this.status = status;
		this.code = code;
	}

	public HttpStatus getStatus() {
		return status;
	}

	public String getCode() {
		return code;
	}
}

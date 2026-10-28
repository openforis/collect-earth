package org.openforis.collect.earth.app.server.api;

/** A problem the user can do something about: answered 400 with its code and message (see ApiExceptionHandler). */
public class ApiException extends RuntimeException {

	private static final long serialVersionUID = 1L;
	private final String code;

	public ApiException(String code, String message) {
		super(message);
		this.code = code;
	}

	public String getCode() {
		return code;
	}
}

package org.openforis.collect.earth.app.server;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Abstract class with common methonds for servlets that access the collected data.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public abstract class DataAccessingServlet {

	@Autowired
	private DataAccessor dataAccessor;
	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	public DataAccessingServlet() {
		super();
	}

	public DataAccessor getDataAccessor() {
		return dataAccessor;
	}

	public Logger getLogger() {
		return logger;
	}

}
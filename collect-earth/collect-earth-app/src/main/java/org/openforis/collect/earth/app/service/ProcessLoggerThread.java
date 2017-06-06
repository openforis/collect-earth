package org.openforis.collect.earth.app.service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;


public class ProcessLoggerThread extends Thread {

	private final static Logger LOGGER = LoggerFactory.getLogger(ProcessLoggerThread.class);

	private InputStream inputStream;


	public ProcessLoggerThread(InputStream inputStream) {
		super();

		this.inputStream = inputStream;
	}


	public void run() {
		try {
			BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream));
			String line = reader.readLine();
			while (line != null) {
				LOGGER.error(line);
				line = reader.readLine();
			}
			reader.close();
			LOGGER.warn("End of logs");
		} catch (IOException e) {
			LOGGER.error("The log reader died unexpectedly.");
		}
	}
}
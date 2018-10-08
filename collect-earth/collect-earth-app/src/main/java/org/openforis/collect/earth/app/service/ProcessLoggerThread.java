package org.openforis.collect.earth.app.service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;


public class ProcessLoggerThread extends Thread {

	private static final Logger LOGGER = LoggerFactory.getLogger(ProcessLoggerThread.class);

	private InputStream inputStream;
	
	private Boolean logOutputAsError;


	public ProcessLoggerThread(InputStream inputStream, Boolean logOutputAsError) {
		super();

		this.inputStream = inputStream;
		this.logOutputAsError = logOutputAsError;
	}


	@Override
	public void run() {
		try {
			BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream));
			String line = reader.readLine();
			while (line != null) {
				if( logOutputAsError )
					LOGGER.error(line);
				else
					LOGGER.warn(line);
				
				line = reader.readLine();
			}
			reader.close();
			LOGGER.warn("End of logs");
		} catch (IOException e) {
			LOGGER.error("The log reader died unexpectedly.", e);
		}
	}
}
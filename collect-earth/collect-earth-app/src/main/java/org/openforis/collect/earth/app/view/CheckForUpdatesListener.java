package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.io.IOException;

import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.service.ProcessLoggerThread;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class CheckForUpdatesListener implements ActionListener {

	Logger logger = LoggerFactory.getLogger( CheckForUpdatesListener.class );
	@Override
	public void actionPerformed(ActionEvent e) {
		// Start the auto_updater
		try {
			String autoUpdateExecutable = getAutoUpdateExecutable();
			
			File autoupdateFile = new File( autoUpdateExecutable);
			
			if( !autoupdateFile.exists() ){
				autoupdateFile = new File( "autoupdate/"+autoUpdateExecutable); //$NON-NLS-1$
			}
			
			if( !autoupdateFile.exists() ){
				logger.error("No "+ autoUpdateExecutable + " found "); //$NON-NLS-1$ //$NON-NLS-2$
				return;
			}
			if( SystemUtils.IS_OS_LINUX ){
				try {
					final ProcessBuilder builder = new ProcessBuilder(new String[] { autoupdateFile.getAbsolutePath() });
					
					builder.redirectErrorStream(true);
					Process p = builder.start();
			
					(new ProcessLoggerThread(p.getInputStream(), Boolean.FALSE)).start();
					(new ProcessLoggerThread(p.getErrorStream(), Boolean.TRUE)).start();
			
				} catch (final IOException e2) {
					logger.error("Error when starting the Autoupdate executable", e2); //$NON-NLS-1$
				}
			}else{
				
				CollectEarthUtils.openFile( autoupdateFile );
			}
		} catch (Exception e1) {
			logger.error("Error when opening the Autoupdate executable", e1); //$NON-NLS-1$
		}
	}

	private String getAutoUpdateExecutable() {
		String autoUpdateExecutable = "autoupdate" ;  //$NON-NLS-1$
		try {
			
			
			if (SystemUtils.IS_OS_WINDOWS){
				autoUpdateExecutable += ".exe"; //$NON-NLS-1$
			}else if (SystemUtils.IS_OS_MAC){
				autoUpdateExecutable += ".app"; //$NON-NLS-1$
			}else if ( SystemUtils.IS_OS_UNIX && System.getProperty("sun.arch.data.model").equals("64")){
				autoUpdateExecutable += "-x64.run"; //$NON-NLS-1$
			}else if ( SystemUtils.IS_OS_UNIX ) {
				autoUpdateExecutable += ".run"; //$NON-NLS-1$
			}

		} catch (Exception e) {
			e.printStackTrace(); // ATTENTION do not use a logger here!
		}
		return autoUpdateExecutable;
	}

}

package org.openforis.collect.earth.app.view;

import java.awt.Desktop;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class OpenOSFileListener implements ActionListener {
	
	private final Logger logger = LoggerFactory.getLogger(OpenOSFileListener.class);
	
	private File fileToOpen;
	
	public OpenOSFileListener(File fileToOpen) {
		super();
		this.fileToOpen = fileToOpen;
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		if (Desktop.isDesktopSupported()) {
		    try {
		        Desktop.getDesktop().open(fileToOpen);
		    } catch (IOException ex) {
		        logger.error("No application registered in the OS to open file " + fileToOpen.getName(),e); //$NON-NLS-1$
		    }
		}
		
	}
}

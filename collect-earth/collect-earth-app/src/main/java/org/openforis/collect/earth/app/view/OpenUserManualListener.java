package org.openforis.collect.earth.app.view;

import java.awt.Desktop;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class OpenUserManualListener implements ActionListener {
	
	private final Logger logger = LoggerFactory.getLogger(OpenUserManualListener.class);
	
	@Override
	public void actionPerformed(ActionEvent e) {
		if (Desktop.isDesktopSupported()) {
		    try {
		        File myFile = new File("UserManual.pdf");
		        Desktop.getDesktop().open(myFile);
		    } catch (IOException ex) {
		        logger.error("No application registered to open PDF",e);
		    }
		}
		
	}
}

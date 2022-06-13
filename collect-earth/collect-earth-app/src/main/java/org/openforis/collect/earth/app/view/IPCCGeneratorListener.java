package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;

import javax.swing.JFrame;
import javax.swing.JOptionPane;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class IPCCGeneratorListener implements ActionListener {
	private Logger logger = LoggerFactory.getLogger( IPCCGeneratorListener.class);
	private JFrame frame;
	private GenerateDatabaseStarter ipccExporterStarter;

	public IPCCGeneratorListener(JFrame frame, GenerateDatabaseStarter ipccExporterStarter) {
		this.frame = frame;
		this.ipccExporterStarter = ipccExporterStarter;
	}


	@Override
	public void actionPerformed(ActionEvent e) {
		try {
			CollectEarthWindow.startWaiting(frame);
			generateIpccData();
		}catch (Exception e1) {
			logger.error("Error starting Saiku server", e1); //$NON-NLS-1$
		} finally{
			CollectEarthWindow.endWaiting(frame);
		}
	}

	private void generateIpccData() {
		if( ipccExporterStarter.isStarting() ){
			JOptionPane.showMessageDialog(frame, Messages.getString("CollectEarthWindow.57"), Messages.getString("CollectEarthWindow.58"), JOptionPane.WARNING_MESSAGE );  //$NON-NLS-1$ //$NON-NLS-2$
		}else{

			int shouldRefreshDb = JOptionPane.YES_OPTION;

			if( ipccExporterStarter.shouldShowRdbGenerationOption() ){

				String refresh = Messages.getString("GenerateRDBAnalysisListener.0"); //$NON-NLS-1$
				String close = Messages.getString("GenerateRDBAnalysisListener.1"); //$NON-NLS-1$
				String[] options = new String[]{ refresh,close};


				shouldRefreshDb = JOptionPane.showOptionDialog(
						frame, Messages.getString("CollectEarthWindow.59"), //$NON-NLS-1$
						Messages.getString("CollectEarthWindow.60"),  //$NON-NLS-1$
						JOptionPane.YES_NO_OPTION,JOptionPane.INFORMATION_MESSAGE,null,options, close  );
			}

			if( shouldRefreshDb != JOptionPane.CLOSED_OPTION ){
				ipccExporterStarter.setShouldRefreshDb( shouldRefreshDb == JOptionPane.YES_OPTION  );
				ipccExporterStarter.initializeAndOpen();
			}
		}
	}

}
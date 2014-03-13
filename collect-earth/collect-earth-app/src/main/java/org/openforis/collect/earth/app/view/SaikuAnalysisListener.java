package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;

import javax.swing.JFrame;
import javax.swing.JOptionPane;

import org.openforis.collect.earth.app.service.SaikuExecutionException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class SaikuAnalysisListener implements ActionListener {
	private Logger logger = LoggerFactory.getLogger( SaikuAnalysisListener.class);
	private JFrame frame;
	private SaikuStarter saikuStarter;
	
	public SaikuAnalysisListener(JFrame frame, SaikuStarter saikuStarter) {
		this.frame = frame;
		this.saikuStarter = saikuStarter;
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		try {

			CollectEarthWindow.startWaiting(frame);
			exportDataToRDB(e);
		}catch (Exception e1) {
			logger.error("Error starting Saiku server", e1); //$NON-NLS-1$
		} finally{
			CollectEarthWindow.endWaiting(frame);
		}
	}
	
	private void exportDataToRDB(ActionEvent e) throws SaikuExecutionException {
		if( saikuStarter.isStarting() ){
			JOptionPane.showMessageDialog(frame, Messages.getString("CollectEarthWindow.57"), Messages.getString("CollectEarthWindow.58"), JOptionPane.WARNING_MESSAGE );  //$NON-NLS-1$ //$NON-NLS-2$
		}else{
			final int shouldRefreshDb = JOptionPane.showConfirmDialog( frame, Messages.getString("CollectEarthWindow.59"), Messages.getString("CollectEarthWindow.60"), JOptionPane.YES_NO_OPTION ); //$NON-NLS-1$ //$NON-NLS-2$
			saikuStarter.setShouldRefreshDb( shouldRefreshDb == JOptionPane.YES_OPTION  );
			saikuStarter.initializeAndOpen();
		}
	}

}
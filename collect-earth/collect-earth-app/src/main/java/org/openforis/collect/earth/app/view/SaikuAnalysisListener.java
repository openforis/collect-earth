package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;

import javax.swing.JFrame;
import javax.swing.JOptionPane;

import org.jdesktop.swingx.JXTipOfTheDay.ShowOnStartupChoice;
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

			int shouldRefreshDb = JOptionPane.YES_OPTION;

			if( saikuStarter.shouldShowRdbGenerationOption() ){ 

				String refresh = Messages.getString("SaikuAnalysisListener.0"); //$NON-NLS-1$
				String close = Messages.getString("SaikuAnalysisListener.1"); //$NON-NLS-1$
				String[] options = new String[]{ refresh,close}; 
				
				
				shouldRefreshDb = JOptionPane.showOptionDialog( 
						frame, Messages.getString("CollectEarthWindow.59"), //$NON-NLS-1$
						Messages.getString("CollectEarthWindow.60"),  //$NON-NLS-1$
						JOptionPane.YES_NO_OPTION,JOptionPane.INFORMATION_MESSAGE,null,options, close  ); 
			}
			
			if( shouldRefreshDb != JOptionPane.CLOSED_OPTION ){
				saikuStarter.setShouldRefreshDb( shouldRefreshDb == JOptionPane.YES_OPTION  );
				saikuStarter.initializeAndOpen();
			}
		}
	}

}
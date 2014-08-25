package org.openforis.collect.earth.app.view;

import javax.swing.JFrame;
import javax.swing.JOptionPane;

import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.SaikuExecutionException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class SaikuStarter {


	private Logger logger = LoggerFactory.getLogger( SaikuStarter.class);
	private JFrame frame;
	private Thread threadInitializingSaiku;
	private AnalysisSaikuService saikuService;
	private boolean  shouldRefreshDb;
	private boolean starting = false;
	private InfiniteProgressMonitor progressStartSaiku;

	public boolean isShouldRefreshDb() {
		return shouldRefreshDb;
	}


	public void setShouldRefreshDb(boolean shouldRefreshDb) {
		this.shouldRefreshDb = shouldRefreshDb;
	}


	SaikuStarter( final AnalysisSaikuService saikuService, final JFrame frame) {
		super();
		this.saikuService = saikuService;
		this.frame = frame;
		
	}
	
	public boolean shouldShowRdbGenerationOption(){
		return saikuService.isRdbFilePresent();
	}

	public boolean isStarting() {
		return starting;
	}
	
	public void initializeAndOpen() {
		threadInitializingSaiku = new Thread("Start Saiku server/initialize RDB"){ //$NON-NLS-1$
			@Override
			public void run() {
				starting = true;
				saikuService.setRefreshDatabase( shouldRefreshDb  );
				try {
					saikuService.prepareDataForAnalysis();
				}catch ( SaikuExecutionException e1) {
					JOptionPane.showMessageDialog(  frame , "<html>" + Messages.getString("CollectEarthWindow.29") + "<br>" +Messages.getString("CollectEarthWindow.40") + "<br/>" + e1.getMessage() + "</html>", Messages.getString("CollectEarthWindow.47"), JOptionPane.INFORMATION_MESSAGE); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$ //$NON-NLS-6$ //$NON-NLS-7$
					logger.warn("The saiku server is not configured", e1); //$NON-NLS-1$ 
				} finally{
					starting = false;
					if( progressStartSaiku != null ){
						progressStartSaiku.close();
					}
						
				}
			}
		};
		
		threadInitializingSaiku.start();
		progressStartSaiku = new InfiniteProgressMonitor( frame, Messages.getString("SaikuStarter.1"), Messages.getString("SaikuStarter.2")); //$NON-NLS-1$ //$NON-NLS-2$
		progressStartSaiku.show();
		
		
		if( progressStartSaiku.isUserCancelled() ){
			saikuService.setUserCancelledOperation(true);
		}
	}
}
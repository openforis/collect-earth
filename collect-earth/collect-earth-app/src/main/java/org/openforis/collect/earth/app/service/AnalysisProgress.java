package org.openforis.collect.earth.app.service;

import org.openforis.concurrency.ProgressListener;

/**
 * Where the long services (the Saiku and IPCC databases, the missing plots) report their progress and learn that
 * the user gave up: what the Swing InfiniteProgressMonitor offered them, as an interface, so a job of the pages
 * (JobProgress) can stand in for the dialog. The services keep calling these as they did.
 */
public interface AnalysisProgress extends ProgressListener {

	/** So many of so many done */
	void updateProgress(int current, int total);

	/** So many of so many done, and what is being done now */
	void updateProgress(int current, int total, String message);

	/** A percent done */
	void updateProgress(int percentage);

	/** What is being done now; the Swing monitor had it called on the event thread */
	void setMessage(String message);

	/** True once the user asked to stop: the services check it between their steps */
	boolean isUserCancelled();

	/** The dialog shown again after it was hidden (IPCCGenerator hides it while its wizard is up); nothing for a job */
	void show();

	void hide();
}

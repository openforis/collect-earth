package org.openforis.collect.earth.app.service.notices;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.stereotype.Component;

/**
 * What EarthApp did a while after the server started: the announcements after 5 seconds, the offer of a new version
 * after 20. On a daemon thread, so neither the start nor the quit waits for the network.
 */
// Not lazy: the context creates its beans lazily, and nothing asks for this one
@Component
@Lazy(false)
public class StartupNotices implements ApplicationListener<ContextRefreshedEvent> {

	static final long ANNOUNCEMENTS_DELAY_MS = 5000;
	static final long UPDATE_DELAY_MS = 20000;

	private final Logger logger = LoggerFactory.getLogger(StartupNotices.class);

	@Autowired
	private AnnouncementService announcements;

	@Autowired
	private UpdateService updates;

	@Override
	public void onApplicationEvent(ContextRefreshedEvent event) {
		Thread thread = new Thread(this::run, "Announcements and update check"); //$NON-NLS-1$
		thread.setDaemon(true);
		thread.start();
	}

	private void run() {
		try {
			Thread.sleep(ANNOUNCEMENTS_DELAY_MS);
			announcements.check();
			Thread.sleep(UPDATE_DELAY_MS - ANNOUNCEMENTS_DELAY_MS);
			updates.offer();
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		} catch (RuntimeException e) {
			logger.error("Error checking for announcements or updates", e); //$NON-NLS-1$
		}
	}
}

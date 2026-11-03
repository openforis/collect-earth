package org.openforis.collect.earth.app.service.notices;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.text.MessageFormat;
import java.util.function.Consumer;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.ProcessLoggerThread;
import org.openforis.collect.earth.app.service.UpdateIniUtils;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * The offer of a new version, as a notice of the pages (what EarthApp.checkForUpdates asked in a dialog), and the
 * updater that Check for updates runs (CheckForUpdatesListener).
 */
@Component
public class UpdateService {

	/** The checks of UpdateIniUtils, which read the manifest online */
	public interface Check {
		boolean shouldWarnUser(LocalPropertiesService properties);

		String versionAvailableOnline();

		String versionDate(String build);
	}

	/** The updater is not next to Collect Earth (an IDE run, or an installation without it). */
	public static class UpdaterMissingException extends Exception {
		private static final long serialVersionUID = 1L;

		UpdaterMissingException(String message) {
			super(message);
		}
	}

	static final String INSTALLER_URL = "https://ossrh-staging-api.central.sonatype.com/service/local/artifact/maven/redirect?r=releases&g=org.openforis.collect.earth&a=collect-earth-installer&v=LATEST&c=osx&e=dmg";

	private final Logger logger = LoggerFactory.getLogger(UpdateService.class);
	private final NoticeService notices;
	private final LocalPropertiesService properties;
	private final Check check;
	private final boolean mac;
	private final Consumer<URI> openUrl;

	@Autowired
	public UpdateService(NoticeService notices, LocalPropertiesService properties) {
		this(notices, properties, new Check() {
			private final UpdateIniUtils ini = new UpdateIniUtils();

			@Override
			public boolean shouldWarnUser(LocalPropertiesService p) {
				return ini.shouldWarnUser(p);
			}

			@Override
			public String versionAvailableOnline() {
				return ini.getVersionAvailableOnline();
			}

			@Override
			public String versionDate(String build) {
				return ini.convertToDate(build);
			}
		}, SystemUtils.IS_OS_MAC, CollectEarthUtils::openUrl);
	}

	/** For the tests */
	UpdateService(NoticeService notices, LocalPropertiesService properties, Check check, boolean mac, Consumer<URI> openUrl) {
		this.notices = notices;
		this.properties = properties;
		this.check = check;
		this.mac = mac;
		this.openUrl = openUrl;
	}

	/**
	 * Posts the offer when there is a newer version online that the user should hear about: Remind me later, Update
	 * now (on a Mac, Download installer: the updater does not work there), Do not remind me again.
	 */
	public void offer() {
		if (!check.shouldWarnUser(properties)) {
			return;
		}
		String online = check.versionAvailableOnline();
		if (StringUtils.isBlank(online)) {
			return;
		}
		// EarthApp.6 is " - Version", and the Swing title had the date stuck to it
		String title = Messages.getString("EarthApp.58") + Messages.getString("EarthApp.6") + " " + check.versionDate(online);
		Notice notice = new Notice("update", Notice.INFO, title, Messages.getString("EarthApp.57")).html()
				.option("later", Messages.getString("EarthApp.3"));
		if (mac) {
			notice.option("download", Messages.getString("EarthApp.51"));
		} else {
			notice.option("now", Messages.getString("EarthApp.4"));
		}
		notice.option("never", Messages.getString("EarthApp.5"));
		notices.post(notice, option -> answered(option, online));
	}

	private void answered(String option, String online) {
		try {
			if ("download".equals(option)) {
				openUrl.accept(new URI(INSTALLER_URL));
			} else if ("now".equals(option)) {
				runUpdater();
			} else if ("never".equals(option)) {
				properties.setValue(EarthProperty.LAST_IGNORED_UPDATE, online);
			}
		} catch (Exception e) {
			logger.error("The answer to the update offer could not be carried out: {}", option, e);
		}
	}

	/** Starts the updater of the platform, next to Collect Earth or in its autoupdate folder. */
	public void runUpdater() throws UpdaterMissingException, IOException {
		runUpdater(new File("."));
	}

	/** @param base where Collect Earth runs from: the working folder, where the installer put the updater */
	void runUpdater(File base) throws UpdaterMissingException, IOException {
		String name = updaterName();
		File updater = new File(base, name);
		if (!updater.exists()) {
			updater = new File(base, "autoupdate/" + name);
		}
		if (!updater.exists()) {
			throw new UpdaterMissingException(MessageFormat.format(Messages.getString("HelpPage.updaterMissing"), name));
		}
		if (SystemUtils.IS_OS_LINUX) {
			ProcessBuilder builder = new ProcessBuilder(updater.getAbsolutePath());
			builder.redirectErrorStream(true);
			Process p = builder.start();
			new ProcessLoggerThread(p.getInputStream(), Boolean.FALSE).start();
			new ProcessLoggerThread(p.getErrorStream(), Boolean.TRUE).start();
		} else {
			CollectEarthUtils.openFile(updater);
		}
	}

	static String updaterName() {
		String name = "autoupdate";
		if (SystemUtils.IS_OS_WINDOWS) {
			return name + ".exe";
		} else if (SystemUtils.IS_OS_MAC) {
			return name + ".app";
		} else if (SystemUtils.IS_OS_UNIX && "64".equals(System.getProperty("sun.arch.data.model"))) {
			return name + "-x64.run";
		} else if (SystemUtils.IS_OS_UNIX) {
			return name + ".run";
		}
		return name;
	}
}

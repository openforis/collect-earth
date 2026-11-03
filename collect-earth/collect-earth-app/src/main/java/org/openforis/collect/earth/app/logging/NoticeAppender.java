package org.openforis.collect.earth.app.logging;

import java.text.MessageFormat;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;

import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.Appender;
import org.apache.logging.log4j.core.Core;
import org.apache.logging.log4j.core.Filter;
import org.apache.logging.log4j.core.Layout;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.LoggerContext;
import org.apache.logging.log4j.core.appender.AbstractAppender;
import org.apache.logging.log4j.core.config.Configuration;
import org.apache.logging.log4j.core.config.Property;
import org.apache.logging.log4j.core.config.plugins.Plugin;
import org.apache.logging.log4j.core.layout.PatternLayout;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;

/**
 * The errors logged, as notices of the pages (see NoticeService), when the user wants them (the exception-shown
 * setting, the "Show exception errors" entry of the Help menu). What JSwingAppender did with a dialog: one notice at
 * a time, and the errors logged while it waits for its answer are counted and reported once, in one more notice,
 * as a save that logs a few hundred parsing errors would otherwise post a few hundred notices.
 */
@Plugin(name = "NoticeAppender", category = Core.CATEGORY_NAME, elementType = Appender.ELEMENT_TYPE, printObject = true)
public class NoticeAppender extends AbstractAppender {

	public static final String NAME = "notice-log";

	private static volatile NoticeAppender installed;

	private final NoticeService notices;
	private final BooleanSupplier shownSetting;
	private volatile Boolean shown;
	private final Object lock = new Object();
	private boolean noticePending;
	private final AtomicInteger errorsWhilePending = new AtomicInteger(0);

	/**
	 * Adds the appender to the root logger at ERROR, once: the configuration of log4j outlives the Spring contexts, which
	 * the server restart creates anew, so an appender there already is given the new context's service instead.
	 *
	 * @param shownSetting the exception-shown setting, read when the setting has not been given with setShown
	 */
	public static synchronized NoticeAppender install(NoticeService notices, BooleanSupplier shownSetting) {
		final LoggerContext ctx = (LoggerContext) LogManager.getContext(false);
		final Configuration config = ctx.getConfiguration();
		NoticeAppender appender = config.getAppender(NAME);
		if (appender != null) {
			appender.stop();
			config.getRootLogger().removeAppender(NAME);
		}
		PatternLayout layout = PatternLayout.newBuilder().withPattern("%-5p %d [%t] %c: %m%n").build();
		appender = new NoticeAppender(notices, shownSetting, layout, null);
		appender.start();
		config.addAppender(appender);
		config.getRootLogger().addAppender(appender, Level.ERROR, null);
		ctx.updateLoggers();
		installed = appender;
		return appender;
	}

	/** For the tests too: the pattern of the message is theirs */
	public NoticeAppender(NoticeService notices, BooleanSupplier shownSetting, Layout<?> layout, Filter filter) {
		super(NAME, filter, layout, true, Property.EMPTY_ARRAY);
		this.notices = notices;
		this.shownSetting = shownSetting;
	}

	/** The appender installed, for the Help menu's switch; null before the first context, as in the tests */
	public static NoticeAppender installed() {
		return installed;
	}

	/** The setting as the Help menu just set it, so the file is not read again */
	public void setShown(boolean shown) {
		this.shown = shown;
	}

	private boolean isShown() {
		Boolean value = shown;
		if (value == null) {
			value = shownSetting.getAsBoolean();
			shown = value;
		}
		return value;
	}

	@Override
	public void append(LogEvent event) {
		try {
			if (!isShown()) {
				return;
			}
			synchronized (lock) {
				if (noticePending) {
					errorsWhilePending.incrementAndGet();
					return;
				}
				noticePending = true;
			}
			post(new String(getLayout().toByteArray(event)));
		} catch (RuntimeException e) {
			// Not logged at error: it would come back here
			synchronized (lock) {
				noticePending = false;
			}
		}
	}

	private void post(String message) {
		notices.post(new Notice("error", Notice.ERROR, Messages.getString("NoticesPage.error.title"), message), option -> answered());
	}

	/** One notice after the other: the errors counted meanwhile become one more, until none were logged */
	private void answered() {
		int more = errorsWhilePending.getAndSet(0);
		if (more > 0) {
			post(MessageFormat.format(Messages.getString("NoticesPage.error.more"), more));
		} else {
			synchronized (lock) {
				noticePending = false;
			}
		}
	}
}

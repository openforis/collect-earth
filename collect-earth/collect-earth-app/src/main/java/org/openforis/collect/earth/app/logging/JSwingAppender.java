package org.openforis.collect.earth.app.logging;

import java.awt.Dimension;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import javax.swing.JEditorPane;
import javax.swing.JOptionPane;
import javax.swing.JScrollPane;
import javax.swing.SwingUtilities;

import org.apache.logging.log4j.core.Appender;
import org.apache.logging.log4j.core.Core;
import org.apache.logging.log4j.core.Filter;
import org.apache.logging.log4j.core.Layout;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.appender.AbstractAppender;
import org.apache.logging.log4j.core.config.Property;
import org.apache.logging.log4j.core.config.plugins.Plugin;
import org.apache.logging.log4j.core.config.plugins.PluginAttribute;
import org.apache.logging.log4j.core.config.plugins.PluginElement;
import org.apache.logging.log4j.core.config.plugins.PluginFactory;
import org.apache.logging.log4j.core.layout.PatternLayout;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
@Plugin(name = "JSwingAppender", category = Core.CATEGORY_NAME, elementType = Appender.ELEMENT_TYPE, printObject = true)
public class JSwingAppender extends AbstractAppender {

	static final String MORE_ERRORS_MESSAGE = "%d more errors were logged while the previous message was open.<br />See the log file, available from the Help menu, for the details.";

	private Boolean showException;

	private final AtomicBoolean dialogOpen = new AtomicBoolean(false);

	private final AtomicInteger errorsWhileDialogOpen = new AtomicInteger(0);

	private Logger logger = LoggerFactory.getLogger( JSwingAppender.class );

	public JSwingAppender(String name, Filter filter, Layout<?> layout, boolean ignoreExceptions, Property[] properties) {
		super(name, filter, layout, ignoreExceptions, properties);
	}

	@PluginFactory
	public static JSwingAppender createAppender(@PluginAttribute("name") String name,
			@PluginElement("Layout") Layout<?> layout, @PluginElement("Filters") Filter filter,
			@PluginAttribute("ignoreExceptions") boolean ignoreExceptions) {

		if (name == null) {
			LoggerFactory.getLogger( JSwingAppender.class ).error("No name provided for JTextAreaAppender");
			return null;
		}

		if (layout == null) {
			layout = PatternLayout.createDefaultLayout();
		}
		return new JSwingAppender(name, filter, layout, ignoreExceptions, Property.EMPTY_ARRAY);
	}

	@Override
	public void append(LogEvent event) {
		try {
			if( isExceptionShown() ) {
				// Only one dialog at a time. The dialog is modal, and a modal dialog keeps dispatching events, so the
				// dialog of the next error used to open inside the previous one : a save that logged a few hundred
				// parsing errors nested a few hundred dialogs and ended in a StackOverflowError (JAVA-COLLECT-EARTH-55V).
				// The errors logged while a dialog is open are counted and reported once it is closed.
				if (!dialogOpen.compareAndSet(false, true)) {
					errorsWhileDialogOpen.incrementAndGet();
					return;
				}

				final String message = new String(this.getLayout().toByteArray(event)).replaceAll("(\r\n|\n)", "<br />");

				SwingUtilities.invokeLater( () -> showDialogs(message) );
			}
		} catch (final Exception e) {
			// ignore case when the platform hasn't yet been initialized
			dialogOpen.set(false);
			logger.debug("Error shown exception", e);
		}

	}

	private void showDialogs(String message) {
		try {
			showErrorDialog(message);
			// One dialog after the other, never one inside the other
			int moreErrors;
			while ((moreErrors = errorsWhileDialogOpen.getAndSet(0)) > 0) {
				showErrorDialog(String.format(MORE_ERRORS_MESSAGE, moreErrors));
			}
		} catch (Exception e) {
			// Avoid creating an infinite loop by catching this exception and not logging it as error
			logger.debug("Error shown exception", e);
		} finally {
			dialogOpen.set(false);
		}
	}

	/**
	 * Shows the message in a modal dialog, so it returns once the user closes it.
	 */
	void showErrorDialog(String message) {
		JEditorPane web = new JEditorPane();
		web.setEditable(false);
		web.setContentType("text/html");
		web.setText(message);

		JScrollPane scrollPane = new JScrollPane(web);
		scrollPane.setPreferredSize(new Dimension(450, 350));

		JOptionPane.showMessageDialog(null, scrollPane, "Error has been logged", JOptionPane.ERROR_MESSAGE);
	}

	private boolean isExceptionShown() {
		if( showException == null ) {
			LocalPropertiesService localPropertiesService = new LocalPropertiesService();
			showException = localPropertiesService.isExceptionShown();
		}
		return showException;
	}

	public void setExceptionShown(Boolean showException) {
		this.showException = showException;
	}
}
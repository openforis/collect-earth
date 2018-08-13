package org.openforis.collect.earth.app.logging;

import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;

import org.apache.logging.log4j.core.Filter;
import org.apache.logging.log4j.core.Layout;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.appender.AbstractAppender;
import org.apache.logging.log4j.core.config.plugins.Plugin;
import org.apache.logging.log4j.core.config.plugins.PluginAttribute;
import org.apache.logging.log4j.core.config.plugins.PluginElement;
import org.apache.logging.log4j.core.config.plugins.PluginFactory;
import org.apache.logging.log4j.core.layout.PatternLayout;

@Plugin(name = "JDialogAppender", category = "Core", elementType = "appender", printObject = true)
public class JDialogAppender extends AbstractAppender {

	private static final long serialVersionUID = 1L;

	public JDialogAppender(String name, Filter filter, Layout<?> layout, boolean ignoreExceptions) {
		super(name, filter, layout, ignoreExceptions);
	}

	@PluginFactory
	public static JDialogAppender createAppender(@PluginAttribute("name") String name,
			@PluginElement("Layout") Layout<?> layout, @PluginElement("Filters") Filter filter,
			@PluginAttribute("ignoreExceptions") boolean ignoreExceptions) {

		if (name == null) {
			LOGGER.error("No name provided for JTextAreaAppender");
			return null;
		}

		if (layout == null) {
			layout = PatternLayout.createDefaultLayout();
		}
		return new JDialogAppender(name, filter, layout, ignoreExceptions);
	}

	@Override
	public void append(LogEvent event) {
		// TODO Auto-generated method stub
		final String message = new String(this.getLayout().toByteArray(event));

		// Append formatted message to text area using the Thread.
		try {
			SwingUtilities.invokeLater(new Runnable() {
				@Override
				public void run() {
					JTextArea = 
					JOptionPane joptionPane = new JOptionPane(message, messageType, optionType)
				}
			});
		} catch (final IllegalStateException e) {
			// ignore case when the platform hasn't yet been iniitialized
		}
	}
}
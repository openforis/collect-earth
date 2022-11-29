package org.openforis.collect.earth.app.logging;

import java.awt.Dimension;

import javax.swing.JEditorPane;
import javax.swing.JOptionPane;
import javax.swing.JScrollPane;
import javax.swing.SwingUtilities;

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

@Plugin(name = "JSwingAppender", category = "Core", elementType = "appender", printObject = true)
public class JSwingAppender extends AbstractAppender {

	private Boolean showException;

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
				final String message = new String(this.getLayout().toByteArray(event)).replaceAll("(\r\n|\n)", "<br />");

				// Append formatted message to text area using the Thread.

				SwingUtilities.invokeLater( () ->  {
					try {
						JEditorPane web = new JEditorPane();
						web.setEditable(false);
						web.setContentType("text/html");
						web.setText(message);

						JScrollPane scrollPane = new JScrollPane(web);
						scrollPane.setPreferredSize(new Dimension(450, 350));

						JOptionPane.showMessageDialog(null, scrollPane, "Error has been loogged", JOptionPane.ERROR_MESSAGE);
					}catch (Exception e) {
						// Avoid creating an infinite loop by catching this exception and not logging it as error
						logger.debug("Error shown exception", e);
					}
				} );
			}
		} catch (final Exception e) {
			// ignore case when the platform hasn't yet been initialized
			logger.debug("Error shown exception", e);
		}

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
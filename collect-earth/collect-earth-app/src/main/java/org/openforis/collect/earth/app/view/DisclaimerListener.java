package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.Frame;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.io.IOException;

import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class DisclaimerListener implements ActionListener {

	JDialog dialog;
	private final LocalPropertiesService localPropertiesService;
	private final Logger logger = LoggerFactory.getLogger(DisclaimerListener.class);
	JTextArea disclaimerTextArea;

	public DisclaimerListener(Frame owner, LocalPropertiesService localPropertiesService) {
		this.localPropertiesService = localPropertiesService;
		dialog = new JDialog(owner, Messages.getString("CollectEarthWindow.4")); //$NON-NLS-1$
		dialog.setLocationRelativeTo(owner);
		dialog.setSize(new Dimension(300, 400));
		dialog.setModal(true);

		final BorderLayout layoutManager = new BorderLayout();

		final JPanel panel = new JPanel(layoutManager);

		dialog.add(panel);

		disclaimerTextArea = new JTextArea();
		disclaimerTextArea.setEditable(false);
		disclaimerTextArea.setLineWrap(true);
		disclaimerTextArea.setWrapStyleWord(true);
		final JScrollPane scrollPane = new JScrollPane(disclaimerTextArea);
		panel.add(scrollPane, BorderLayout.CENTER);
		scrollPane.setPreferredSize(new Dimension(250, 250));

		final JButton close = new JButton(Messages.getString("CollectEarthWindow.5")); //$NON-NLS-1$
		close.addActionListener(new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				dialog.setVisible(false);
			}
		});
		panel.add(close, BorderLayout.SOUTH);
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		disclaimerTextArea.setText(getDisclaimerText());
		dialog.setVisible(true);
	}

	private String getDisclaimerFilePath(String suffix_lang) {
		return "resources/disclaimer_" + suffix_lang + ".txt";
	}

	private String getDisclaimerText() {
		try {
			final String suffix_lang = localPropertiesService.getUiLanguage().getLocale().getLanguage();
			return FileUtils.readFileToString(new File(getDisclaimerFilePath(suffix_lang)));
		} catch (final IOException e) {
			logger.error("Disclaimer text not found", e); //$NON-NLS-1$
			return Messages.getString("CollectEarthWindow.8"); //$NON-NLS-1$
		}
	}

}

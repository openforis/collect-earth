package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.Frame;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;

import org.apache.commons.io.FileUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class OpenTextFileListener implements ActionListener {

	JDialog dialog;
	private final Logger logger = LoggerFactory.getLogger(OpenTextFileListener.class);
	JTextArea disclaimerTextArea;
	private String filePath;

	public OpenTextFileListener(Frame owner, String filePath, String title) {

		this.filePath = filePath;
		dialog = new JDialog(owner, title + " " + filePath); //$NON-NLS-1$
		dialog.setLocationRelativeTo(owner);
		dialog.setSize(new Dimension(450, 400));
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
		scrollPane.setPreferredSize(new Dimension(450, 400));

		final JButton close = new JButton(Messages.getString("CollectEarthWindow.5")); //$NON-NLS-1$
		close.addActionListener( e -> dialog.setVisible(false) );
		panel.add(close, BorderLayout.SOUTH);
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		disclaimerTextArea.setText(getTextContents());
		dialog.setVisible(true);
	}

	private String getTextContents() {
		try {

			return FileUtils.readFileToString(new File( filePath ), StandardCharsets.UTF_8);
		} catch (final IOException e) {
			logger.error(Messages.getString("OpenTextFileListener.0") + filePath.toString(), e);  //$NON-NLS-1$
			return Messages.getString("CollectEarthWindow.8"); //$NON-NLS-1$
		}
	}

}

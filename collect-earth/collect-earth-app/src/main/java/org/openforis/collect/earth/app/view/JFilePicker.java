package org.openforis.collect.earth.app.view;

import java.awt.FlowLayout;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;

import javax.swing.JButton;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.event.DocumentListener;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class JFilePicker extends JPanel {
	
	private static final long serialVersionUID = 9057893034177011651L;

	private JLabel label;
	private JTextField textField;
	private JButton button;
	private Logger logger = LoggerFactory.getLogger(this.getClass());
	private JFileChooser fileChooser;
	private int mode;
	public static final int MODE_OPEN = 1;
	public static final int MODE_SAVE = 2;

	public JFilePicker(String textFieldLabel, String originalPathValue, String buttonLabel) {

		fileChooser = new JFileChooser();

		if (originalPathValue != null && originalPathValue.length() > 0) {
			try {
				File originalFile = new File(originalPathValue);
				fileChooser.setCurrentDirectory(originalFile.getParentFile());
			} catch (Exception e) {
				logger.error("Unable to find parent folder for " + originalPathValue, e);
			}
		}

		setLayout(new FlowLayout(FlowLayout.CENTER, 5, 5));

		// creates the GUI
		label = new JLabel(textFieldLabel);

		textField = new JTextField(originalPathValue, 20);
		button = new JButton(buttonLabel);

		if (originalPathValue != null && originalPathValue.length() > 0) {
			textField.setCaretPosition(originalPathValue.length() - 1);
		}

		button.addActionListener(new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent evt) {
				buttonActionPerformed(evt);
			}
		});

		add(label);
		add(textField);
		add(button);

	}

	public void addChangeListener(DocumentListener listener) {
		textField.getDocument().addDocumentListener(listener);
	}

	public void addFileTypeFilter(String extension, String description, boolean setSelected) {
		FileTypeFilter filter = new FileTypeFilter(extension, description);
		fileChooser.addChoosableFileFilter(filter);
		if (setSelected) {
			fileChooser.setFileFilter(filter);
		}
	}

	private void buttonActionPerformed(ActionEvent evt) {
		if (mode == MODE_OPEN) {
			if (fileChooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
				textField.setText(relativize(fileChooser.getSelectedFile()));
			}
		} else if (mode == MODE_SAVE) {
			if (fileChooser.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) {
				textField.setText(relativize(fileChooser.getSelectedFile()));
			}
		}
	}

	public JFileChooser getFileChooser() {
		return this.fileChooser;
	}

	public String getSelectedFilePath() {
		return textField.getText();
	}

	private String relativize(File selectedFile) {
		File dummyFile = new File("dummy.txt");
		String pathParentDummy = dummyFile.getAbsolutePath().substring(0, dummyFile.getAbsolutePath().length() - dummyFile.getName().length());
		return new File(pathParentDummy).toURI().relativize(selectedFile.toURI()).getPath();
	}

	public void setMode(int mode) {
		this.mode = mode;
	}
}
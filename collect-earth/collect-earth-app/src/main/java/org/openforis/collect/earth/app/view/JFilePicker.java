package org.openforis.collect.earth.app.view;

import java.awt.Color;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;

import javax.swing.JButton;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.border.BevelBorder;
import javax.swing.event.DocumentListener;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class JFilePicker extends JPanel {
	
	public enum DlgMode{MODE_OPEN,MODE_SAVE };
	
	private static final long serialVersionUID = 9057893034177011651L;

	private JLabel label;
	private JTextField textField;
	private JButton button;
	private Logger logger = LoggerFactory.getLogger(this.getClass());
	private JFileChooser fileChooser;
	
	private DlgMode mode;

	public JFilePicker(String textFieldLabel, String originalPathValue, String buttonLabel, DlgMode mode) {

		fileChooser = new JFileChooser();
		setBorder( new BevelBorder( BevelBorder.RAISED ));
		this.mode = mode;
		if (originalPathValue != null && originalPathValue.length() > 0) {
			try {
				File originalFile = new File(originalPathValue);
				if( originalFile.exists() ){
					fileChooser.setCurrentDirectory(originalFile.getParentFile());
				}
			} catch (Exception e) {
				logger.error("Unable to find parent folder for " + originalPathValue, e); //$NON-NLS-1$
			}
		}

		
		// creates the GUI
		label = new JLabel(textFieldLabel);
		setTextField(new JTextField(originalPathValue, 20));
		button = new JButton(buttonLabel);

		if (originalPathValue != null && originalPathValue.length() > 0) {
			getTextField().setCaretPosition(originalPathValue.length() - 1);
		}

		button.addActionListener(new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent evt) {
				buttonActionPerformed(evt);
			}
		});

		
		setLayout(new GridBagLayout());
		
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.WEST;
		constraints.insets = new Insets(2, 2, 2, 2);
		constraints.fill = GridBagConstraints.BOTH;

		add(label, constraints);
		
		constraints.gridy = 1;
		constraints.weightx =1;
		add(getTextField(), constraints);
		constraints.gridx = 1;
		constraints.weightx = 0;
		add(button, constraints);

	}

	public void addChangeListener(DocumentListener listener) {
		getTextField().getDocument().addDocumentListener(listener);
	}

	public void addFileTypeFilter(String extension, String description, boolean setSelected) {
		FileTypeFilter filter = new FileTypeFilter(extension, description);
		fileChooser.addChoosableFileFilter(filter);
		if (setSelected) {
			fileChooser.setFileFilter(filter);
		}
	}

	private void buttonActionPerformed(ActionEvent evt) {
		if (mode == DlgMode.MODE_OPEN) {
			if (fileChooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
				//getTextField().setText(relativize(fileChooser.getSelectedFile()));
				getTextField().setText( fileChooser.getSelectedFile().getAbsolutePath() );
			}
		} else if (mode == DlgMode.MODE_SAVE) {
			if (fileChooser.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) {
				//getTextField().setText(relativize(fileChooser.getSelectedFile()));
				getTextField().setText( fileChooser.getSelectedFile().getAbsolutePath() );
			}
		}
	}

	public JFileChooser getFileChooser() {
		return this.fileChooser;
	}

	public String getSelectedFilePath() {
		return getTextField().getText();
	}
/*
	private String relativize(File selectedFile) {
		File dummyFile = new File("dummy.txt"); //$NON-NLS-1$
		String pathParentDummy = dummyFile.getAbsolutePath().substring(0, dummyFile.getAbsolutePath().length() - dummyFile.getName().length());
		return new File(pathParentDummy).toURI().relativize(selectedFile.toURI()).getPath();
	}
*/
	public void setFolderChooser() {
		fileChooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
	}

	public JTextField getTextField() {
		return textField;
	}

	private void setTextField(JTextField textField) {
		this.textField = textField;
	}

	public void setTextBackground(Color bgColor) {
		getTextField().setBackground(bgColor);
	}
	
	@Override
	public void setEnabled(boolean enabled) {
		button.setEnabled(enabled);
		textField.setEnabled(enabled);
	}
	
}
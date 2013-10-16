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

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
 
public class JFilePicker extends JPanel {
   
    /**
	 * 
	 */
	private static final long serialVersionUID = 9057893034177011651L;
	private JLabel label;
    private JTextField textField;
    private JButton button;
     
    private Logger logger = LoggerFactory.getLogger( this.getClass() );
    private JFileChooser fileChooser;
     
    private int mode;
    public static final int MODE_OPEN = 1;
    public static final int MODE_SAVE = 2;
     
    public JFilePicker(String textFieldLabel, String originalPathValue, String buttonLabel) {
       
        fileChooser = new JFileChooser();
        
        if( originalPathValue != null && originalPathValue.length() > 0 ){
        	try {
				File originalFile = new File( originalPathValue );
				fileChooser.setCurrentDirectory( originalFile.getParentFile() );
			} catch (Exception e) {
				logger.error("Unable to find parent folder for " + originalPathValue, e);
			}
        }
         
        setLayout(new FlowLayout(FlowLayout.CENTER, 5, 5));
 
        // creates the GUI
        label = new JLabel(textFieldLabel);
         
        textField = new JTextField(originalPathValue, 20);
        button = new JButton(buttonLabel);
         
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
     
    private void buttonActionPerformed(ActionEvent evt) {
        if (mode == MODE_OPEN) {
            if (fileChooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
                textField.setText(fileChooser.getSelectedFile().getAbsolutePath());
            }
        } else if (mode == MODE_SAVE) {
            if (fileChooser.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) {
                textField.setText(fileChooser.getSelectedFile().getAbsolutePath());
            }
        }
    }
 
    public void addFileTypeFilter(String extension, String description) {
        FileTypeFilter filter = new FileTypeFilter(extension, description);
        fileChooser.addChoosableFileFilter(filter);
    }
     
    public void setMode(int mode) {
        this.mode = mode;
    }
     
    public String getSelectedFilePath() {
        return textField.getText();
    }
     
    public JFileChooser getFileChooser() {
        return this.fileChooser;
    }
}
package org.openforis.collect.earth.app.view;

import java.io.File;

import javax.swing.JFileChooser;
import javax.swing.JOptionPane;

public class JFileChooserExistsAware extends JFileChooser {

	private static final long serialVersionUID = 1L;

	public JFileChooserExistsAware(File lastFolder) {
		super(lastFolder);
	}

	public JFileChooserExistsAware() {
		super();
	}

	@Override
	public void approveSelection(){
		File f = getSelectedFile();
		if(f.exists() && getDialogType() == SAVE_DIALOG){
			int result = JOptionPane.showConfirmDialog(this,"The file exists, overwrite?","Existing file",JOptionPane.YES_NO_CANCEL_OPTION);
			switch(result){
			case JOptionPane.YES_OPTION:
				super.approveSelection();
				return;
			case JOptionPane.NO_OPTION:
				return;
			case JOptionPane.CLOSED_OPTION:
				return;
			case JOptionPane.CANCEL_OPTION:
				cancelSelection();
				return;
			}
		}
		super.approveSelection();
	}        
}

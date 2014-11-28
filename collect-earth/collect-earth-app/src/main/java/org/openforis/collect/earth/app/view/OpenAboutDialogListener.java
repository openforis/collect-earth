package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;

import javax.swing.JFrame;

public class OpenAboutDialogListener implements ActionListener{

	JFrame parent;
	String title;
	
	public OpenAboutDialogListener(JFrame parentFrame, String title) {
		this.parent =  parentFrame;
		this.title = title;
	}
	
	@Override
	public void actionPerformed(ActionEvent e) {
		AboutDialog aboutDialog = new AboutDialog(parent, title);
		aboutDialog.setLocationRelativeTo(parent);
	
		aboutDialog.setModal(true);
		aboutDialog.setVisible(true);
	}

}

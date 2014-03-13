package org.openforis.collect.earth.app.view;

import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JProgressBar;
import javax.swing.SwingUtilities;

public class InfiniteProgressMonitor {

	JDialog infiniteWaitingDialog;

	private boolean userCancelled = false;

	private JDialog dialog;

	private JOptionPane pane;

	private String cancelOption;
	
	private JLabel label;

	public InfiniteProgressMonitor(JFrame parentFrame, String title, String message) {

		final JProgressBar infiniteProgress = new JProgressBar();
		infiniteProgress.setIndeterminate(true);
		label = new JLabel(message);

		final Object[] dialogItems = { label, infiniteProgress };

		cancelOption = "Cancel operation"; //$NON-NLS-1$
		final Object[] options = { cancelOption };
		setPane(new JOptionPane(dialogItems, JOptionPane.PLAIN_MESSAGE, JOptionPane.YES_NO_CANCEL_OPTION, null, options));
		setDialog(getPane().createDialog(parentFrame, title));
		getDialog().setModal(true);


	}
	
	public void setMessage(String msg){
		label.setText(msg);
	}

	public void close() {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				hide();
				getDialog().dispose();
			}
		});
	}

	private JDialog getDialog() {
		return dialog;
	}

	private void hide() {
		getDialog().setVisible(false);
	}

	public boolean isShowing() {
		return getDialog().isShowing();
	}

	public boolean isUserCancelled() {
		return userCancelled;
	}

	private void setDialog(JDialog dialog) {
		this.dialog = dialog;
	}

	public void setUserCancelled(boolean userCancelled) {
		this.userCancelled = userCancelled;
	}

	public void show() {
		getDialog().setVisible(true);
		if (getPane().getValue().equals(cancelOption)) {
			setUserCancelled(true);
		}
	}

	private JOptionPane getPane() {
		return pane;
	}

	private void setPane(JOptionPane pane) {
		this.pane = pane;
	}

}

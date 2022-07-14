package org.openforis.collect.earth.app.view;

import java.awt.Component;
import java.lang.reflect.InvocationTargetException;

import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JProgressBar;
import javax.swing.SwingUtilities;

import org.apache.commons.lang3.StringUtils;
import org.openforis.concurrency.Progress;
import org.openforis.concurrency.ProgressListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class InfiniteProgressMonitor implements ProgressListener {

	JDialog infiniteWaitingDialog;

	private boolean userCancelled = false;

	private JDialog dialog;

	private JOptionPane pane;

	private String cancelOption;

	private JLabel label;

	JProgressBar infiniteProgress;
	
	private Logger logger = LoggerFactory.getLogger( InfiniteProgressMonitor.class );
	
	public InfiniteProgressMonitor(Component parentFrame, String title, String message) {

		infiniteProgress = new JProgressBar();
		infiniteProgress.setIndeterminate(true);
		label = new JLabel(message);

		final Object[] dialogItems = { label, infiniteProgress };

		cancelOption = Messages.getString("InfiniteProgressMonitor.0"); //$NON-NLS-1$
		final Object[] options = { cancelOption };
		setPane(new JOptionPane(dialogItems, JOptionPane.PLAIN_MESSAGE, JOptionPane.YES_NO_CANCEL_OPTION, null,
				options));
		setDialog(getPane().createDialog(parentFrame, title));
		getDialog().setModal(true);

	}

	public void updateProgress(int current, int total) {

		updateProgress(current, total, null);

	}
	
	public void updateProgress(int current, int total, String msg) {

		Runnable updateTask = () -> {
			infiniteProgress.setString(current + "/" + total);
			if (infiniteProgress.isIndeterminate()) {
				infiniteProgress.setIndeterminate(false);
				infiniteProgress.setStringPainted(true);
			}

			infiniteProgress.setMaximum(total);

			infiniteProgress.setValue(current);
			if( StringUtils.isNotBlank( msg ))
				setMessage( msg );
		};
		
		SwingUtilities.invokeLater( updateTask );

	}

	public void updateProgress(int currentPercentage) {
		Runnable updateTask = () -> {
			infiniteProgress.setString(currentPercentage + "%");
			if (infiniteProgress.isIndeterminate()) {
				infiniteProgress.setIndeterminate(false);
				infiniteProgress.setStringPainted(true);
			}

			infiniteProgress.setMaximum(100);

			infiniteProgress.setValue(currentPercentage);
		};
		
		SwingUtilities.invokeLater( updateTask );

	}

	public void setMessage(String msg) {
		label.setText(msg);
	}

	public void close() {
		SwingUtilities.invokeLater(() -> {
				hide();
				getDialog().dispose();
		});
	}

	private JDialog getDialog() {
		return dialog;
	}

	public void hide() {
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

			Runnable showTask = () -> {
				getDialog().setVisible(true);
				if (getPane().getValue() == null  // User closes the dialog
						|| 
					getPane().getValue().equals(cancelOption) // User clicks on cancel option
				) {
					setUserCancelled(true);
				}
			};
			SwingUtilities.invokeLater( showTask );
		

	}

	public void showLater() {
		Runnable showLater = () -> {
			getDialog().setVisible(true);
			if (getPane().getValue() == null  // User closes the dialog
					|| 
				getPane().getValue().equals(cancelOption) // User clicks on cancel option
			) {
				setUserCancelled(true);
			}
		};
		SwingUtilities.invokeLater( showLater );

	}

	private JOptionPane getPane() {
		return pane;
	}

	private void setPane(JOptionPane pane) {
		this.pane = pane;
	}

	@Override
	public void progressMade(Progress progress) {
		updateProgress((int) progress.getProcessedItems());
	}

}

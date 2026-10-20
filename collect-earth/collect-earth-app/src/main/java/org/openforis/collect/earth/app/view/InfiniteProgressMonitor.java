package org.openforis.collect.earth.app.view;

import java.awt.Component;

import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JProgressBar;
import javax.swing.SwingUtilities;

import org.apache.commons.lang3.StringUtils;
import org.openforis.concurrency.Progress;
import org.openforis.concurrency.ProgressListener;

public class InfiniteProgressMonitor implements ProgressListener {

	JDialog infiniteWaitingDialog;

	private boolean userCancelled = false;

	private JDialog dialog;

	private JOptionPane pane;

	private String cancelOption;

	private JLabel label;

	JProgressBar infiniteProgress;
	
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

	private transient Runnable onUserCancelled;

	public boolean isUserCancelled() {
		return userCancelled;
	}

	private void setDialog(JDialog dialog) {
		this.dialog = dialog;
	}

	public void setUserCancelled(boolean userCancelled) {
		this.userCancelled = userCancelled;
		if (userCancelled && onUserCancelled != null) {
			onUserCancelled.run();
		}
	}

	/**
	 * Registers what to do when the user dismisses this dialog. show() and showLater() only queue the dialog on the event
	 * thread and return, so asking isUserCancelled() on the next line always answered false and the cancel was ignored.
	 *
	 * @param onUserCancelled Called on the event thread, once, when the user closes the dialog or clicks on cancel
	 */
	public void setOnUserCancelled(Runnable onUserCancelled) {
		this.onUserCancelled = onUserCancelled;
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
		long total = progress.getTotalItems();
		if (total <= 0) {
			// Nothing to measure against : leave the bar as it is rather than showing a wrong percentage
			return;
		}
		// The processed items were passed to updateProgress(int), which labels its argument as a percentage and caps the bar
		// at 100 : a survey of 4000 plots showed "100%" from the hundredth record on
		updateProgress((int) progress.getProcessedItems(), (int) total);
	}

}

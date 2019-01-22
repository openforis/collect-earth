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

		SwingUtilities.invokeLater(new Runnable() {

			@Override
			public void run() {

				infiniteProgress.setString(current + "/" + total);
				if (infiniteProgress.isIndeterminate()) {
					infiniteProgress.setIndeterminate(false);
					infiniteProgress.setStringPainted(true);
				}

				infiniteProgress.setMaximum(total);

				infiniteProgress.setValue(current);
				if( StringUtils.isNotBlank( msg ))
					setMessage( msg );
			}
		});

	}

	public void updateProgress(int currentPercentage) {

		SwingUtilities.invokeLater(new Runnable() {

			@Override
			public void run() {

				infiniteProgress.setString(currentPercentage + "%");
				if (infiniteProgress.isIndeterminate()) {
					infiniteProgress.setIndeterminate(false);
					infiniteProgress.setStringPainted(true);
				}

				infiniteProgress.setMaximum(100);

				infiniteProgress.setValue(currentPercentage);
			}
		});

	}

	public void setMessage(String msg) {
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
		try {
			SwingUtilities.invokeAndWait(new Runnable() {

				@Override
				public void run() {
					getDialog().setVisible(true);
					if (getPane().getValue() == null  // User closes the dialog
							|| 
						getPane().getValue().equals(cancelOption) // User clicks on cancel option
					) {
						setUserCancelled(true);
					}
				}

			});
		} catch (InvocationTargetException | InterruptedException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}

	}

	public void showLater() {
		SwingUtilities.invokeLater(new Runnable() {

			@Override
			public void run() {
				getDialog().setVisible(true);
				if (getPane().getValue() == null  // User closes the dialog
						|| 
					getPane().getValue().equals(cancelOption) // User clicks on cancel option
				) {
					setUserCancelled(true);
				}
			}

		});

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

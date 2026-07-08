package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Font;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.text.DateFormat;
import java.util.Date;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.Timer;

import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao.QueueStatus;
import org.openforis.collect.earth.app.service.cloud.CloudSyncService;

/**
 * Read-only status window for the background cloud sync. Shows how many records
 * are waiting, failing, or already synced, the time of the last successful sync
 * and the last error, and offers a "Sync now" button that nudges the
 * {@link CloudSyncService} to drain the queue immediately. While it is visible it
 * refreshes itself every few seconds so the operator can watch the queue drain.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class CloudSyncStatusDialog extends JDialog {

	private static final long serialVersionUID = 1L;
	private static final int REFRESH_INTERVAL_MS = 3000;

	private final transient CloudSyncService cloudSyncService;
	private final transient LocalPropertiesService localPropertiesService;
	private final DateFormat dateFormat = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT);

	private final JLabel pendingValue = new JLabel();
	private final JLabel failedValue = new JLabel();
	private final JLabel syncedValue = new JLabel();
	private final JLabel lastSyncValue = new JLabel();
	private final JLabel lastErrorValue = new JLabel();
	private final transient Timer refreshTimer;

	public CloudSyncStatusDialog(JFrame owner, CloudSyncService cloudSyncService,
			LocalPropertiesService localPropertiesService) {
		super(owner, Messages.getString("CloudSyncStatusDialog.title"), true); //$NON-NLS-1$
		this.cloudSyncService = cloudSyncService;
		this.localPropertiesService = localPropertiesService;

		setLayout(new BorderLayout());
		add(buildContentPanel(), BorderLayout.CENTER);
		add(buildButtonPanel(), BorderLayout.SOUTH);

		refreshTimer = new Timer(REFRESH_INTERVAL_MS, e -> refresh());
		refreshTimer.setRepeats(true);

		refresh();
		pack();
		setLocationRelativeTo(owner);
	}

	private JPanel buildContentPanel() {
		JPanel panel = new JPanel(new GridBagLayout());
		panel.setBorder(BorderFactory.createEmptyBorder(12, 16, 12, 16));

		GridBagConstraints labelConstraints = new GridBagConstraints();
		labelConstraints.gridx = 0;
		labelConstraints.anchor = GridBagConstraints.LINE_START;
		labelConstraints.insets = new Insets(4, 0, 4, 12);

		GridBagConstraints valueConstraints = new GridBagConstraints();
		valueConstraints.gridx = 1;
		valueConstraints.anchor = GridBagConstraints.LINE_START;
		valueConstraints.insets = new Insets(4, 0, 4, 0);

		int row = 0;
		String projectId = localPropertiesService.getCloudProjectId();
		addRow(panel, labelConstraints, valueConstraints, row++, "CloudSyncStatusDialog.projectLabel", //$NON-NLS-1$
				bold(new JLabel(projectId == null || projectId.trim().isEmpty()
						? Messages.getString("CloudSyncStatusDialog.none") : projectId))); //$NON-NLS-1$
		addRow(panel, labelConstraints, valueConstraints, row++, "CloudSyncStatusDialog.pendingLabel", pendingValue); //$NON-NLS-1$
		addRow(panel, labelConstraints, valueConstraints, row++, "CloudSyncStatusDialog.failedLabel", failedValue); //$NON-NLS-1$
		addRow(panel, labelConstraints, valueConstraints, row++, "CloudSyncStatusDialog.syncedLabel", syncedValue); //$NON-NLS-1$
		addRow(panel, labelConstraints, valueConstraints, row++, "CloudSyncStatusDialog.lastSyncLabel", lastSyncValue); //$NON-NLS-1$
		addRow(panel, labelConstraints, valueConstraints, row, "CloudSyncStatusDialog.lastErrorLabel", lastErrorValue); //$NON-NLS-1$

		return panel;
	}

	private void addRow(JPanel panel, GridBagConstraints labelConstraints, GridBagConstraints valueConstraints, int row,
			String labelKey, JLabel value) {
		labelConstraints.gridy = row;
		valueConstraints.gridy = row;
		JLabel label = new JLabel(Messages.getString(labelKey));
		panel.add(label, labelConstraints);
		panel.add(value, valueConstraints);
	}

	private JLabel bold(JLabel label) {
		label.setFont(label.getFont().deriveFont(Font.BOLD));
		return label;
	}

	private JPanel buildButtonPanel() {
		JPanel panel = new JPanel();
		panel.setBorder(BorderFactory.createEmptyBorder(0, 12, 10, 12));

		JButton syncNowButton = new JButton(Messages.getString("CloudSyncStatusDialog.syncNowButton")); //$NON-NLS-1$
		syncNowButton.addActionListener(e -> {
			cloudSyncService.syncNowAsync();
			refresh();
			JOptionPane.showMessageDialog(this, Messages.getString("CloudSyncStatusDialog.syncNowStarted"), //$NON-NLS-1$
					Messages.getString("CloudSyncStatusDialog.title"), JOptionPane.INFORMATION_MESSAGE); //$NON-NLS-1$
		});
		panel.add(syncNowButton);

		JButton refreshButton = new JButton(Messages.getString("CloudSyncStatusDialog.refreshButton")); //$NON-NLS-1$
		refreshButton.addActionListener(e -> refresh());
		panel.add(refreshButton);

		JButton closeButton = new JButton(Messages.getString("CloudSyncStatusDialog.closeButton")); //$NON-NLS-1$
		closeButton.addActionListener(e -> dispose());
		panel.add(closeButton);

		return panel;
	}

	private void refresh() {
		if (!localPropertiesService.isCloudSyncEnabled()) {
			pendingValue.setText(Messages.getString("CloudSyncStatusDialog.notEnabled")); //$NON-NLS-1$
			failedValue.setText(""); //$NON-NLS-1$
			syncedValue.setText(""); //$NON-NLS-1$
			lastSyncValue.setText(""); //$NON-NLS-1$
			lastErrorValue.setText(""); //$NON-NLS-1$
			return;
		}
		QueueStatus status = cloudSyncService.getStatusSnapshot();
		pendingValue.setText(Integer.toString(status.getPending()));
		failedValue.setText(Integer.toString(status.getFailed()));
		syncedValue.setText(Integer.toString(status.getSynced()));
		lastSyncValue.setText(formatDate(status.getLastSyncedOn()));
		String lastError = status.getLastError();
		lastErrorValue.setText(lastError == null || lastError.trim().isEmpty()
				? Messages.getString("CloudSyncStatusDialog.none") : lastError); //$NON-NLS-1$
	}

	private String formatDate(Date date) {
		return date == null ? Messages.getString("CloudSyncStatusDialog.never") : dateFormat.format(date); //$NON-NLS-1$
	}

	@Override
	public void setVisible(boolean visible) {
		if (visible) {
			refresh();
			refreshTimer.start();
		} else {
			refreshTimer.stop();
		}
		super.setVisible(visible);
	}
}

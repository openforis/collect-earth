package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.Window;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JTextField;
import javax.swing.SwingWorker;

import org.openforis.collect.earth.app.service.cloud.CloudApiClient;

/**
 * Shared modal dialog for authenticating against a Collect Earth cloud server.
 * Used from the database settings panel (re-login), the "Join cloud project" flow
 * and 401 recovery. When constructed with an invite token it also offers inline
 * registration (there is no separate web registration page in Phase A).
 *
 * <p>Network calls run on a background {@link SwingWorker} so the UI never blocks;
 * on success the dialog stores the session token and disposes.</p>
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class CloudLoginDialog extends JDialog {

	private static final long serialVersionUID = 1L;

	private final transient CloudApiClient apiClient;
	private final String baseUrl;
	private final String inviteToken;

	private final JTextField usernameField = new JTextField(20);
	private final JPasswordField passwordField = new JPasswordField(20);
	private final JLabel errorLabel = new JLabel(" ");
	private JButton loginButton;
	private JButton registerButton;

	private transient String resultToken;
	private String resultUsername;

	public CloudLoginDialog(Window owner, CloudApiClient apiClient, String baseUrl, String inviteToken) {
		super(owner, Messages.getString("CloudLoginDialog.title"), ModalityType.APPLICATION_MODAL); //$NON-NLS-1$
		this.apiClient = apiClient;
		this.baseUrl = baseUrl;
		this.inviteToken = inviteToken;

		setLayout(new BorderLayout());
		add(buildForm(), BorderLayout.CENTER);
		add(buildButtons(), BorderLayout.SOUTH);
		pack();
		setLocationRelativeTo(owner);
	}

	private JPanel buildForm() {
		JPanel panel = new JPanel(new GridBagLayout());
		panel.setBorder(BorderFactory.createEmptyBorder(12, 16, 8, 16));

		GridBagConstraints labelC = new GridBagConstraints();
		labelC.gridx = 0;
		labelC.anchor = GridBagConstraints.LINE_START;
		labelC.insets = new Insets(4, 0, 4, 10);
		GridBagConstraints fieldC = new GridBagConstraints();
		fieldC.gridx = 1;
		fieldC.fill = GridBagConstraints.HORIZONTAL;
		fieldC.weightx = 1.0;
		fieldC.insets = new Insets(4, 0, 4, 0);

		labelC.gridy = 0;
		fieldC.gridy = 0;
		panel.add(new JLabel(Messages.getString("CloudLoginDialog.usernameLabel")), labelC); //$NON-NLS-1$
		panel.add(usernameField, fieldC);

		labelC.gridy = 1;
		fieldC.gridy = 1;
		panel.add(new JLabel(Messages.getString("CloudLoginDialog.passwordLabel")), labelC); //$NON-NLS-1$
		panel.add(passwordField, fieldC);

		errorLabel.setForeground(Color.RED);
		GridBagConstraints errorC = new GridBagConstraints();
		errorC.gridx = 0;
		errorC.gridy = 2;
		errorC.gridwidth = 2;
		errorC.anchor = GridBagConstraints.LINE_START;
		errorC.insets = new Insets(4, 0, 0, 0);
		panel.add(errorLabel, errorC);

		return panel;
	}

	private JPanel buildButtons() {
		JPanel panel = new JPanel();
		panel.setBorder(BorderFactory.createEmptyBorder(0, 12, 10, 12));

		loginButton = new JButton(Messages.getString("CloudLoginDialog.loginButton")); //$NON-NLS-1$
		loginButton.addActionListener(e -> submit(false));
		panel.add(loginButton);

		if (inviteToken != null) {
			registerButton = new JButton(Messages.getString("CloudLoginDialog.registerButton")); //$NON-NLS-1$
			registerButton.addActionListener(e -> submit(true));
			panel.add(registerButton);
		}

		JButton cancelButton = new JButton(Messages.getString("CloudLoginDialog.cancelButton")); //$NON-NLS-1$
		cancelButton.addActionListener(e -> dispose());
		panel.add(cancelButton);

		getRootPane().setDefaultButton(loginButton);
		return panel;
	}

	private void submit(boolean register) {
		final String username = usernameField.getText().trim();
		final String password = new String(passwordField.getPassword());
		if (username.isEmpty() || password.isEmpty()) {
			errorLabel.setText(Messages.getString("CloudLoginDialog.emptyFields")); //$NON-NLS-1$
			return;
		}
		errorLabel.setText(" "); //$NON-NLS-1$
		setBusy(true);

		new SwingWorker<String, Void>() {
			@Override
			protected String doInBackground() throws Exception {
				return register ? apiClient.register(baseUrl, username, password, inviteToken)
						: apiClient.login(baseUrl, username, password);
			}

			@Override
			protected void done() {
				try {
					String token = get();
					if (token == null || token.isEmpty()) {
						errorLabel.setText(Messages.getString("CloudLoginDialog.noToken")); //$NON-NLS-1$
						setBusy(false);
						return;
					}
					resultToken = token;
					resultUsername = username;
					dispose();
				} catch (Exception ex) {
					Throwable cause = ex.getCause() != null ? ex.getCause() : ex;
					errorLabel.setText(cause.getMessage() == null
							? Messages.getString("CloudLoginDialog.failed") : cause.getMessage()); //$NON-NLS-1$
					setBusy(false);
				}
			}
		}.execute();
	}

	private void setBusy(boolean busy) {
		for (JComponent c : new JComponent[] { usernameField, passwordField, loginButton, registerButton }) {
			if (c != null) {
				c.setEnabled(!busy);
			}
		}
		setCursor(java.awt.Cursor.getPredefinedCursor(busy ? java.awt.Cursor.WAIT_CURSOR : java.awt.Cursor.DEFAULT_CURSOR));
	}

	/** True if the user successfully authenticated. */
	public boolean isSucceeded() {
		return resultToken != null;
	}

	public String getResultToken() {
		return resultToken;
	}

	public String getResultUsername() {
		return resultUsername;
	}
}

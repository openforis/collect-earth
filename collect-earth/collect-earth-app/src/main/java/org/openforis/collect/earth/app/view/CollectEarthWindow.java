package org.openforis.collect.earth.app.view;

import java.awt.Color;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.Window;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.File;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.net.MalformedURLException;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import javax.swing.BorderFactory;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JMenuItem;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.WindowConstants;
import javax.swing.border.Border;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Component
@Lazy(false)
public class CollectEarthWindow {

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private CollectEarthTransferHandler collectEarthTransferHandler;

	@Autowired
	private CollectEarthMenu collectEarthMenu;

	public static void endWaiting(Window frame) {
		frame.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.DEFAULT_CURSOR));
	}

	public static void startWaiting(Window frame) {
		frame.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.WAIT_CURSOR));
	}

	private JFrame frame;
	private final Logger logger = LoggerFactory.getLogger(CollectEarthWindow.class);

	public static final Color ERROR_COLOR = new Color(225, 124, 124);

	public CollectEarthWindow() throws IOException {
		// Create and set up the window.
		JFrame framePriv = new JFrame(Messages.getString("CollectEarthWindow.19"));//$NON-NLS-1$

		setFrame(framePriv);
	}

	@PostConstruct
	public void init() {
		Messages.setLocale(localPropertiesService.getUiLanguage().getLocale());
		javax.swing.SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				try {

					CollectEarthWindow.this.openWindow();

				} catch (final Exception e) {
					logger.error("Cannot start Earth App", e); //$NON-NLS-1$
					System.exit(0);
				}
			}
		});
	}

	@PreDestroy
	public void cleanUp() throws InvocationTargetException, InterruptedException {
		SwingUtilities.invokeAndWait(new Runnable() {

			@Override
			public void run() {
				CollectEarthWindow.this.getFrame().dispose();
			}
		});
	}

	private void addWindowClosingListener() {
		getFrame().addWindowListener(new WindowAdapter() {

			@Override
			public void windowClosing(WindowEvent e) {
				try {
					final String keepOpen = Messages.getString("CollectEarthWindow.37"); //$NON-NLS-1$
					final String close = Messages.getString("CollectEarthWindow.42"); //$NON-NLS-1$
					final String[] options = new String[] { close, keepOpen };

					final int confirmation = JOptionPane.showOptionDialog(getFrame(),
							Messages.getString("CollectEarthWindow.22"), //$NON-NLS-1$
							Messages.getString("CollectEarthWindow.23"), //$NON-NLS-1$
							JOptionPane.YES_NO_OPTION, JOptionPane.QUESTION_MESSAGE, null, options, keepOpen);

					if (confirmation == JOptionPane.YES_OPTION) {
						final Thread stopServer = new Thread("Stopping server") {
							@Override
							public void run() {
								try {
									// getServerController().stopServer();
									EarthApp.quitServer();
								} catch (final Exception e) {
									logger.error("Error when trying to closing the server", e); //$NON-NLS-1$
								}
							};
						};

						getFrame().setVisible(false);
						getFrame().dispose();
						stopServer.start();
						Thread.sleep(5000);

						System.exit(0);
					}
				} catch (final Exception e1) {
					logger.error("Error when trying to shutdown the server when window is closed", e1); //$NON-NLS-1$
				}

			}
		});
	}

	private void disableMenuItems() {
		if (localPropertiesService.getOperationMode().equals(OperationMode.CLIENT_MODE)) {
			for (final JMenuItem menuItem : collectEarthMenu.getServerMenuItems()) {
				menuItem.setEnabled(false);
			}
		}
	}

	private void displayWindow() {
		getFrame().setLocationRelativeTo(null);
		getFrame().pack();
		getFrame().setVisible(true);
	}

	protected ActionListener getCloseActionListener() {
		return new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent e) {
				getFrame().dispatchEvent(new WindowEvent(getFrame(), WindowEvent.WINDOW_CLOSING));
			}
		};
	}

	public JFrame getFrame() {
		return frame;
	}

	private String getOperator() {
		return localPropertiesService.getOperator();
	}

	private void initializeMenu() {
		
		collectEarthMenu.removeAll();
		collectEarthMenu.init();
		getFrame().setJMenuBar( collectEarthMenu );

		disableMenuItems();
	}

	private void initializePanel() {
		final JPanel pane = new JPanel(new GridBagLayout());

		final Border raisedetched = BorderFactory.createRaisedBevelBorder();
		pane.setBorder(raisedetched);

		// Handle Drag and Drop of files into the panel
		pane.setTransferHandler(collectEarthTransferHandler);

		final GridBagConstraints c = new GridBagConstraints();

		final JTextField operatorTextField = new JTextField(getOperator(), 30);
		if (StringUtils.isBlank(getOperator())) {
			operatorTextField.setBackground(ERROR_COLOR);
		}

		final JLabel operatorTextLabel = new JLabel(Messages.getString("CollectEarthWindow.26"), SwingConstants.CENTER); //$NON-NLS-1$
		operatorTextLabel.setSize(100, 20);

		final JButton updateOperator = new JButton(Messages.getString("CollectEarthWindow.27")); //$NON-NLS-1$
		c.insets = new Insets(3, 3, 3, 3);
		c.fill = GridBagConstraints.HORIZONTAL;
		c.gridx = 0;
		c.gridy = 0;
		pane.add(operatorTextLabel, c);

		c.weightx = 0;
		c.gridx = 1;
		c.gridy = 0;
		pane.add(operatorTextField, c);

		c.gridx = 2;
		c.gridy = 0;
		pane.add(updateOperator, c);

		c.gridx = 0;
		c.gridy++;
		c.gridwidth = GridBagConstraints.REMAINDER;
		pane.add(new JLabel(Messages.getString("CollectEarthWindow.28") + "<br>" //$NON-NLS-1$ //$NON-NLS-2$
				+ Messages.getString("CollectEarthWindow.30")), c); //$NON-NLS-1$

		c.gridx = 0;
		c.gridy++;
		c.gridwidth = GridBagConstraints.REMAINDER;
		c.fill = GridBagConstraints.NONE;
		final JButton closeButton = new JButton(Messages.getString("CollectEarthWindow.32")); //$NON-NLS-1$
		closeButton.addActionListener(getCloseActionListener());
		pane.add(closeButton, c);

		getFrame().getContentPane().add(pane);

		updateOperator.addActionListener(new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				final String operatorName = operatorTextField.getText().trim();
				if (operatorName.length() > 5 && operatorName.length() < 50) {
					localPropertiesService.saveOperator(operatorName);
					operatorTextField.setBackground(Color.white);
				} else {
					JOptionPane.showMessageDialog(getFrame(), Messages.getString("CollectEarthWindow.33"), //$NON-NLS-1$
							Messages.getString("CollectEarthWindow.34"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
					operatorTextField.setText(getOperator());
				}

			}
		});

	}

	private void initializeWindow() {

		// Initialize the translations
		Messages.setLocale(localPropertiesService.getUiLanguage().getLocale());

		// frame.setSize(400, 300);
		getFrame().setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
		getFrame().setResizable(false);
		try {
			getFrame().setIconImage(
					new ImageIcon(new File("images/smallOpenForisBanner.png").toURI().toURL()).getImage()); //$NON-NLS-1$
		} catch (final MalformedURLException e2) {
			logger.error(Messages.getString("CollectEarthWindow.21"), e2); //$NON-NLS-1$
		}

		addWindowClosingListener();
	}

	protected void openWindow() {

		initializeWindow();
		initializePanel();
		initializeMenu();
		displayWindow();

		if (StringUtils.isBlank(getOperator())) {
			JOptionPane.showMessageDialog(getFrame(), Messages.getString("CollectEarthWindow.35"), //$NON-NLS-1$
					Messages.getString("CollectEarthWindow.36"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
		}

		changeFrameTitle();
	}

	public void changeFrameTitle() {
		String name = " - No survey loaded";
		if (earthSurveyService.getCollectSurvey() != null) {
			if (!StringUtils.isBlank(earthSurveyService.getCollectSurvey()
					.getProjectName(localPropertiesService.getUiLanguage().getLocale().getLanguage()))) {
				name = " - " + earthSurveyService.getCollectSurvey()
						.getProjectName(localPropertiesService.getUiLanguage().getLocale().getLanguage());
			} else if (!StringUtils.isBlank(earthSurveyService.getCollectSurvey().getProjectName())) {
				name = " - " + earthSurveyService.getCollectSurvey().getProjectName();
			} else {
				name = " - " + earthSurveyService.getCollectSurvey()
						.getDescription(localPropertiesService.getUiLanguage().getLocale().getLanguage());
			}
		}
		getFrame().setTitle(Messages.getString("CollectEarthWindow.19") + name);
	}

	void setFrame(JFrame frame) {
		this.frame = frame;
	}

}
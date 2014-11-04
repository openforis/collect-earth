package org.openforis.collect.earth.app.view;

import java.awt.Color;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.util.ArrayList;
import java.util.List;

import javax.swing.BorderFactory;
import javax.swing.ButtonGroup;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JMenu;
import javax.swing.JMenuBar;
import javax.swing.JMenuItem;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JRadioButtonMenuItem;
import javax.swing.JTextField;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.WindowConstants;
import javax.swing.border.Border;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.BackupSqlLiteService;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.ExportActionListener.RecordsToExport;
import org.openforis.collect.manager.RecordManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeansException;

/**
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
public class CollectEarthWindow {

	public static void endWaiting(JFrame frame) {
		frame.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.DEFAULT_CURSOR));
	}

	public static void startWaiting(JFrame frame) {
		frame.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.WAIT_CURSOR));
	}

	private JFrame frame;
	private final Logger logger = LoggerFactory.getLogger(CollectEarthWindow.class);
	private ServerController serverController;
	public static final Color ERROR_COLOR = new Color(225, 124, 124);
	
	private String backupFolder;

	private final List<JMenuItem> serverMenuItems = new ArrayList<JMenuItem>();

	public CollectEarthWindow() throws IOException {

		// Create and set up the window.
		setFrame(new JFrame(Messages.getString("CollectEarthWindow.19"))); //$NON-NLS-1$

	}

	private void addImportExportMenu(JMenu menu) {

		final JMenu ieSubmenu = new JMenu(Messages.getString("CollectEarthWindow.44")); //$NON-NLS-1$
		JMenuItem menuItem;
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.13")); //$NON-NLS-1$
		menuItem.addActionListener(getExportActionListener(DataFormat.CSV, RecordsToExport.ALL));
		ieSubmenu.add(menuItem);

		final JMenu xmlExportSubmenu = new JMenu(Messages.getString("CollectEarthWindow.24")); //$NON-NLS-1$

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.45")); //$NON-NLS-1$
		menuItem.addActionListener(getExportActionListener(DataFormat.ZIP_WITH_XML, RecordsToExport.ALL));
		xmlExportSubmenu.add(menuItem);

		final JMenuItem exportModifiedRecords = new JMenuItem(Messages.getString("CollectEarthWindow.61")); //$NON-NLS-1$
		exportModifiedRecords.addActionListener(getExportActionListener(DataFormat.ZIP_WITH_XML, RecordsToExport.MODIFIED_SINCE_LAST_EXPORT));
		xmlExportSubmenu.add(exportModifiedRecords);

		final JMenuItem exportDataRangeRecords = new JMenuItem("Export data to XML (from specific date)"); //$NON-NLS-1$
		exportDataRangeRecords.addActionListener(getExportActionListener(DataFormat.ZIP_WITH_XML, RecordsToExport.PICK_FROM_DATE));
		xmlExportSubmenu.add(exportDataRangeRecords);

		ieSubmenu.add(xmlExportSubmenu);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.6")); //$NON-NLS-1$
		menuItem.addActionListener(getExportActionListener(DataFormat.FUSION, RecordsToExport.ALL));
		ieSubmenu.add(menuItem);

		ieSubmenu.addSeparator();

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.46")); //$NON-NLS-1$
		menuItem.addActionListener(getImportActionListener(DataFormat.ZIP_WITH_XML));
		ieSubmenu.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.55")); //$NON-NLS-1$
		menuItem.addActionListener(getImportActionListener(DataFormat.CSV));
		ieSubmenu.add(menuItem);

		menu.add(ieSubmenu);

		serverMenuItems.add(ieSubmenu); // This menu should only be shown if the DB is local ( not if Collect Earth is acting as a client )
	}

	private void addWindowClosingListener() {
		getFrame().addWindowListener(new WindowAdapter() {

			@Override
			public void windowClosing(WindowEvent e) {
				try {
					final String keepOpen = Messages.getString("CollectEarthWindow.37"); //$NON-NLS-1$
					final String close = Messages.getString("CollectEarthWindow.42"); //$NON-NLS-1$
					final String[] options = new String[] { close, keepOpen };

					final int confirmation = JOptionPane.showOptionDialog(getFrame(), Messages.getString("CollectEarthWindow.22"), //$NON-NLS-1$
							Messages.getString("CollectEarthWindow.23"),  //$NON-NLS-1$ 
							JOptionPane.YES_NO_OPTION, JOptionPane.QUESTION_MESSAGE, null, options, keepOpen);

					if (confirmation == JOptionPane.YES_OPTION) {
						final Thread stopServer = new Thread() {
							@Override
							public void run() {
								try {
									getServerController().stopServer();
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
		if (getLocalPropertiesService().getOperationMode().equals(OperationMode.CLIENT_MODE)) {
			for (final JMenuItem menuItem : serverMenuItems) {
				menuItem.setEnabled(false);
			}
		}
	}

	private void displayWindow() {
		getFrame().setLocationRelativeTo(null);
		getFrame().pack();
		getFrame().setVisible(true);
	}

	private ActionListener getCloseActionListener() {
		return new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent e) {
				frame.dispatchEvent(new WindowEvent(frame, WindowEvent.WINDOW_CLOSING));
			}
		};
	}

	private DataImportExportService getDataExportService() {
		if (getServerController() != null) {
			return getServerController().getContext().getBean(DataImportExportService.class);
		} else {
			return null;
		}
	}

	private String getDisclaimerFilePath() {
		final String suffix_lang = getLocalPropertiesService().getUiLanguage().getLocale().getLanguage();
		return "resources/disclaimer_" + suffix_lang + ".txt"; //$NON-NLS-1$ //$NON-NLS-2$
	}

	private EarthSurveyService getEarthSurveyService() {
		if (getServerController() != null) {
			return getServerController().getContext().getBean(EarthSurveyService.class);
		} else {
			return null;
		}
	}

	private ActionListener getExportActionListener(final DataFormat exportFormat, final RecordsToExport xmlExportType) {
		return new ExportActionListener(exportFormat, xmlExportType, frame, getLocalPropertiesService(), getDataExportService(),
				getEarthSurveyService());
	}

	private JFrame getFrame() {
		return frame;
	}

	private ActionListener getImportActionListener(final DataFormat importFormat) {
		return new ImportActionListener(importFormat, frame, getLocalPropertiesService(), getDataExportService());
	}

	private JMenu getLanguageMenu() {

		final ActionListener actionLanguage = new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent e) {
				try {
					final String langName = ((JRadioButtonMenuItem) e.getSource()).getName();
					final UI_LANGUAGE language = UI_LANGUAGE.valueOf(langName);
					getLocalPropertiesService().setUiLanguage(language);
					
					SwingUtilities.invokeLater( new Thread(){
						public void run() {
							
							frame.getContentPane().removeAll();
							frame.dispose();
							
							openWindow();
						};
					});
					
				} catch (final Exception ex) {
					ex.printStackTrace();
					logger.error("Error while changing language", ex);
				}
			}
		};

		final JMenu menuLanguage = new JMenu(Messages.getString("CollectEarthWindow.2")); //$NON-NLS-1$

		final ButtonGroup group = new ButtonGroup();
		final UI_LANGUAGE[] languages = UI_LANGUAGE.values();

		for (final UI_LANGUAGE language : languages) {
			final JRadioButtonMenuItem langItem = new JRadioButtonMenuItem(language.getLabel());
			langItem.setName(language.name());
			langItem.addActionListener(actionLanguage);
			menuLanguage.add(langItem);
			group.add(menuLanguage);
			if (getLocalPropertiesService().getUiLanguage().equals(language)) {
				langItem.setSelected(true);
			}

		}

		return menuLanguage;
	}

	private LocalPropertiesService getLocalPropertiesService() {
		if (getServerController() != null && getServerController().getContext()!=null ) {
			return getServerController().getContext().getBean(LocalPropertiesService.class);
		} else {
			return new LocalPropertiesService();
		}
	}

	private String getLogFilePath() {
		return FolderFinder.getAppDataFolder() + "/earth_error.log"; //$NON-NLS-1$ 
	}

	public JMenuBar getMenu(JFrame frame) {
		// Where the GUI is created:
		JMenuBar menuBar;
		JMenuItem menuItem;

		// Create the menu bar.
		menuBar = new JMenuBar();

		// Build file menu in the menu bar.
		final JMenu fileMenu = new JMenu(Messages.getString("CollectEarthWindow.10")); //$NON-NLS-1$

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.11")); //$NON-NLS-1$
		menuItem.addActionListener(getCloseActionListener());
		fileMenu.add(menuItem);
		menuBar.add(fileMenu);

		// Build tools menu in the menu bar.
		final JMenu toolsMenu = new JMenu(Messages.getString("CollectEarthWindow.12")); //$NON-NLS-1$

		addImportExportMenu(toolsMenu);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.14")); //$NON-NLS-1$
		menuItem.addActionListener(getSaikuAnalysisActionListener());
		toolsMenu.add(menuItem);

		/*
		 * menuItem = new JMenuItem("Fix PNG coordinates"); //$NON-NLS-1$
		 * menuItem.addActionListener(getFixCoordinates());
		 * serverMenuItems.add(menuItem); // This menu should only be shown if the DB is local ( not if Collect Earth is acting as a client )
		 * toolsMenu.add(menuItem);
		 */

		toolsMenu.addSeparator();

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.15")); //$NON-NLS-1$
		menuItem.addActionListener(getPropertiesAction(frame));
		toolsMenu.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.18")); //$NON-NLS-1$
		menuItem.addActionListener(new MissingPlotsListener(getRecordManager(), getEarthSurveyService(), frame, getLocalPropertiesService()));
		serverMenuItems.add(menuItem); // This menu should only be shown if the DB is local ( not if Collect Earth is acting as a client )
		toolsMenu.add(menuItem);

		toolsMenu.addSeparator();
		final JMenu languageMenu = getLanguageMenu();
		toolsMenu.add(languageMenu);

		menuBar.add(toolsMenu);

		// Build help menu in the menu bar.
		final JMenu menuHelp = new JMenu(Messages.getString("CollectEarthWindow.16")); //$NON-NLS-1$

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.17")); //$NON-NLS-1$
		menuItem.addActionListener(new OpenTextFileListener(frame, getDisclaimerFilePath(), Messages.getString("CollectEarthWindow.4")));//$NON-NLS-1$
		menuHelp.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.50")); //$NON-NLS-1$
		menuItem.addActionListener(new OpenUserManualListener());
		menuHelp.add(menuItem);

		menuHelp.addSeparator();

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.52")); //$NON-NLS-1$
		menuItem.addActionListener(new OpenTextFileListener(frame, getLogFilePath(), Messages.getString("CollectEarthWindow.53"))); //$NON-NLS-1$
		menuHelp.add(menuItem);

		menuHelp.addSeparator();

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.51")); //$NON-NLS-1$
		menuItem.addActionListener(new CheckForUpdatesListener());
		menuHelp.add(menuItem);

		menuBar.add(menuHelp);

		return menuBar;
	}

	private String getOperator() {
		return getLocalPropertiesService().getOperator();
	}

	private EarthProjectsService getProjectsService() {
		if (getServerController() != null) {
			return getServerController().getContext().getBean(EarthProjectsService.class);
		} else {
			final EarthProjectsService earthProjectsService = new EarthProjectsService();
			earthProjectsService.init(getLocalPropertiesService());
			return earthProjectsService;
		}
	}

	private ActionListener getPropertiesAction(final JFrame owner) {

		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				final JDialog dialog = new OptionWizard(owner, getLocalPropertiesService(), getProjectsService(), backupFolder, getSaikuService());
				dialog.setVisible(true);
				dialog.pack();
			}
		};

	}

	private RecordManager getRecordManager() {
		if (getServerController() != null) {
			return getServerController().getContext().getBean(RecordManager.class);
		} else {
			return null;
		}
	}

	private ActionListener getSaikuAnalysisActionListener() {
		return new SaikuAnalysisListener(frame, getSaikuStarter());
	}

	private AnalysisSaikuService getSaikuService() {
		if (getServerController() != null) {
			return getServerController().getContext().getBean(AnalysisSaikuService.class);
		} else {
			return null;
		}
	}

	private SaikuStarter getSaikuStarter() {
		if (getServerController() != null) {
			return new SaikuStarter(getSaikuService(), frame);
		} else {
			return null;
		}
	}

	private ServerController getServerController() {
		return serverController;
	}

	private void initializeMenu() {
		getFrame().setJMenuBar(getMenu(getFrame()));

		disableMenuItems();
	}

	private void initializePanel() {
		final JPanel pane = new JPanel(new GridBagLayout());
		final Border raisedetched = BorderFactory.createRaisedBevelBorder();
		pane.setBorder(raisedetched);

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
					getLocalPropertiesService().saveOperator(operatorName);
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
		Messages.setLocale(getLocalPropertiesService().getUiLanguage().getLocale());

		// frame.setSize(400, 300);
		getFrame().setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
		getFrame().setResizable(false);
		try {
			getFrame().setIconImage(new ImageIcon(new File("images/smallOpenForisBanner.png").toURI().toURL()).getImage()); //$NON-NLS-1$
		} catch (final MalformedURLException e2) {
			logger.error(Messages.getString("CollectEarthWindow.21"), e2); //$NON-NLS-1$
		}

		addWindowClosingListener();
	}

	public void openWindow() {

		initializeWindow();
		initializePanel();
		initializeMenu();
		displayWindow();

		if (StringUtils.isBlank(getOperator())) {
			JOptionPane.showMessageDialog(getFrame(), Messages.getString("CollectEarthWindow.35"), //$NON-NLS-1$
					Messages.getString("CollectEarthWindow.36"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
		}

	}

	void setFrame(JFrame frame) {
		this.frame = frame;
	}

	public void setServerController(ServerController serverControllerParam) {

		try {
			if (serverControllerParam != null) {
				this.serverController = serverControllerParam;
				final BackupSqlLiteService backupService = serverControllerParam.getContext().getBean(BackupSqlLiteService.class);
				this.backupFolder = backupService.getBackUpFolder().getAbsolutePath();

			} else {
				this.serverController = null;
				this.getLocalPropertiesService().init();
				this.backupFolder = null;
			}
		} catch (final BeansException e) {
			logger.error("Error while setting the ServerController", e); //$NON-NLS-1$
		} catch (final IOException e) {
			logger.error("Error while setting the ServerController", e); //$NON-NLS-1$
		}
	}

}
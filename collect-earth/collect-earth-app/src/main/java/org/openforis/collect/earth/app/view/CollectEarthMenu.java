package org.openforis.collect.earth.app.view;

import java.awt.event.ActionListener;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

import javax.swing.ButtonGroup;
import javax.swing.JCheckBoxMenuItem;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JMenu;
import javax.swing.JMenuBar;
import javax.swing.JMenuItem;
import javax.swing.JOptionPane;
import javax.swing.JRadioButtonMenuItem;
import javax.swing.SwingUtilities;

import org.apache.commons.lang3.SystemUtils;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.LoggerContext;
import org.apache.logging.log4j.core.config.Configuration;
import org.kordamp.ikonli.materialdesign.MaterialDesign;
import org.kordamp.ikonli.swing.FontIcon;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.logging.JSwingAppender;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.BackupSqlLiteService;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.IPCCGeneratorService;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.KmlImportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.MissingPlotService;
import org.openforis.collect.earth.app.view.ExportActionListener.RecordsToExport;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class CollectEarthMenu extends JMenuBar implements InitializingBean {

	@Autowired
	private transient DataImportExportService dataImportExportService;

	@Autowired
	private transient KmlImportService kmlImportService;
	
	@Autowired
	private KmlGeneratorService kmlGeneratorService;

	@Autowired
	private transient MissingPlotService missingPlotService;

	@Autowired
	private transient AnalysisSaikuService analysisSaikuService;
	
	@Autowired
	private transient IPCCGeneratorService ipccGeneratorService;

	@Autowired
	private transient LocalPropertiesService localPropertiesService;

	@Autowired
	private transient CollectEarthWindow collectEarthWindow;

	@Autowired
	private transient EarthSurveyService earthSurveyService;

	@Autowired
	private transient EarthProjectsService earthProjectsService;

	@Autowired
	private transient BackupSqlLiteService backupSqlLiteService;

	@Autowired
	private transient RemovePlotsFromDBDlg removePlotsFromDBDlg;

	private static final long serialVersionUID = -2457052260968029351L;
	private static final String USER_MANUAL_FILENAME = "UserManual.pdf";
	private static final String LOG_FILENAME = "earth_error.log";
	private static final String DISCLAIMER_FILENAME_PREFIX = "disclaimer_";
	private static final String DISCLAIMER_FILENAME_SUFFIX = ".txt";
	private static final String DISCLAIMER_DEFAULT = "disclaimer_en.txt";
	private static final String RESOURCES_FOLDER = "resources";
	private static final String JSWING_APPENDER_NAME = "jswing-log";
	private static final String UNKNOWN_ERROR_MESSAGE = "Unknown error occurred";
	
	private final List<JMenuItem> serverMenuItems = new ArrayList<>();
	private JFrame frame;
	private final transient org.slf4j.Logger logger = LoggerFactory.getLogger(CollectEarthMenu.class);

	public CollectEarthMenu() {
		// Where the GUI is created:
		super();
	}

	protected void init() {
		setFrame(collectEarthWindow.getFrame());

		// Build file menu in the menu bar.
		this.add( getFileMenu() );

		// Build tools menu in the menu bar.
		this.add(getToolsMenu());

		// Build help menu in the menu bar.
		this.add(getHelpMenu());
	}

	@Override
	public void afterPropertiesSet() throws Exception {
		init();
	}

	@Override
	public JMenu getHelpMenu() {
		JMenu menuHelp = new JMenu(Messages.getString("CollectEarthWindow.16")); //$NON-NLS-1$
		JMenuItem menuItem;
		File surveyGuide = earthSurveyService.getSurveyGuide();
		if( surveyGuide != null && surveyGuide.exists() && surveyGuide.canRead() ) {
			menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.70")); //$NON-NLS-1$
			menuItem.addActionListener( (e) -> {
				try {
					CollectEarthUtils.openFile( surveyGuide );
				} catch (Exception ex) {
					showErrorDialog("Error opening survey guide: " + surveyGuide.getAbsolutePath(), ex);
				}
			});
			menuHelp.add(menuItem);
			menuHelp.addSeparator();
		}

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.56")); //$NON-NLS-1$
		menuItem.addActionListener(new OpenAboutDialogListener(frame, Messages.getString("CollectEarthWindow.62"))); //$NON-NLS-1$
		menuHelp.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.17")); //$NON-NLS-1$
		menuItem.addActionListener(
				new OpenTextFileListener(frame, getDisclaimerFilePath(), Messages.getString("CollectEarthWindow.4")));//$NON-NLS-1$
		menuHelp.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.50")); //$NON-NLS-1$
		menuItem.addActionListener( (e) -> {
			File userManual = new File(USER_MANUAL_FILENAME);
			if (userManual.exists() && userManual.canRead()) {
				try {
					CollectEarthUtils.openFile(userManual);
				} catch (Exception ex) {
					showErrorDialog("Error opening user manual", ex);
				}
			} else {
				JOptionPane.showMessageDialog(frame, 
					"User manual not found: " + USER_MANUAL_FILENAME,
					"File Not Found", JOptionPane.WARNING_MESSAGE);
			}
		});
		menuHelp.add(menuItem);


		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.64")); //$NON-NLS-1$
		menuItem.addActionListener(new OpenSupportForum());
		menuHelp.add(menuItem);

		menuHelp.addSeparator();

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.52")); //$NON-NLS-1$
		menuItem.addActionListener(
				new OpenTextFileListener(frame, getLogFilePath(), Messages.getString("CollectEarthWindow.53"))); //$NON-NLS-1$
		menuHelp.add(menuItem);

		JCheckBoxMenuItem checkboxErrors = new JCheckBoxMenuItem(Messages.getString("CollectEarthMenu.9"), localPropertiesService.isExceptionShown()); //$NON-NLS-1$
		checkboxErrors.addActionListener( e -> {
			// This sets/unsets the property that is checked when an exception is catch by the JSwingAppender log4j2 appender 

			Boolean showException = checkboxErrors.isSelected();
			localPropertiesService.setExceptionShown( showException );

			final LoggerContext ctx = (LoggerContext) LogManager.getContext(false);
			final Configuration config = ctx.getConfiguration();

			JSwingAppender jSwingAppender = config.getAppender(JSWING_APPENDER_NAME);

			jSwingAppender.setExceptionShown( showException );
		}

				); 
		menuHelp.add(checkboxErrors);


		menuHelp.addSeparator();

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.51")); //$NON-NLS-1$
		menuItem.addActionListener(new CheckForUpdatesListener());
		menuHelp.add(menuItem);
		return menuHelp;
	}

	private JMenu getToolsMenu() {
		JMenu toolsMenu = new JMenu(Messages.getString("CollectEarthWindow.12")); //$NON-NLS-1$

		addImportExportMenu(toolsMenu);
		addAnalysisMenuItems(toolsMenu);
		addKmlAndDataMenuItems(toolsMenu);
		addSettingsAndUtilityMenuItems(toolsMenu);
		
		return toolsMenu;
	}
	
	private void addAnalysisMenuItems(JMenu toolsMenu) {
		JMenuItem menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.14")); //$NON-NLS-1$
		menuItem.addActionListener(getSaikuAnalysisActionListener());
		toolsMenu.add(menuItem);
		
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.71")); //$NON-NLS-1$
		menuItem.addActionListener(getSaikuToolExportActionListener());
		menuItem.setEnabled(SystemUtils.IS_OS_WINDOWS);
		toolsMenu.add(menuItem);

		toolsMenu.addSeparator();
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.72")); //$NON-NLS-1$
		menuItem.addActionListener(getIPCCExportActionListener());
		toolsMenu.add(menuItem);
	}
	
	private void addKmlAndDataMenuItems(JMenu toolsMenu) {
		toolsMenu.addSeparator();
		
		JMenuItem kmlImportItem = new JMenuItem(Messages.getString("CollectEarthWindow.54")); //$NON-NLS-1$
		kmlImportItem.addActionListener(createKmlImportActionListener());
		serverMenuItems.add(kmlImportItem);
		toolsMenu.add(kmlImportItem);

		JMenuItem dataFolderItem = new JMenuItem(Messages.getString("CollectEarthWindow.67")); //$NON-NLS-1$
		dataFolderItem.setIcon(FontIcon.of(MaterialDesign.MDI_FOLDER));
		dataFolderItem.addActionListener(createDataFolderActionListener());
		serverMenuItems.add(dataFolderItem);
		toolsMenu.add(dataFolderItem);
	}
	
	private void addSettingsAndUtilityMenuItems(JMenu toolsMenu) {
		toolsMenu.addSeparator();

		JMenuItem settingsItem = new JMenuItem(Messages.getString("CollectEarthWindow.15")); //$NON-NLS-1$
		settingsItem.addActionListener(getPropertiesAction(frame));
		settingsItem.setIcon(FontIcon.of(MaterialDesign.MDI_SETTINGS));
		toolsMenu.add(settingsItem);
		toolsMenu.add(getUtilitiesMenu());

		toolsMenu.addSeparator();
		toolsMenu.add(getLanguageMenu());
	}
	
	private ActionListener createKmlImportActionListener() {
		return new ApplyOptionChangesListener(this.getFrame(), localPropertiesService) {
			@Override
			protected void applyProperties() {
				try {
					if (kmlImportService != null && kmlImportService.prompToOpenKml(getFrame())) {
						restartEarth();
					}
				} catch (Exception e1) {
					showErrorDialog("Error importing KML file", e1);
				}
			}
		};
	}
	
	private ActionListener createDataFolderActionListener() {
		return e -> {
			try {
				String dataFolder = FolderFinder.getCollectEarthDataFolder();
				if (dataFolder != null) {
					File folder = new File(dataFolder);
					if (folder.exists() && folder.isDirectory()) {
						CollectEarthUtils.openFolderInExplorer(dataFolder);
					} else {
						JOptionPane.showMessageDialog(frame, 
							"Data folder not found: " + dataFolder,
							"Folder Not Found", JOptionPane.WARNING_MESSAGE);
					}
				} else {
					JOptionPane.showMessageDialog(frame, 
						"Could not determine data folder location",
						"Error", JOptionPane.ERROR_MESSAGE);
				}
			} catch (IOException e1) {
				showErrorDialog("Could not open the data folder", e1);
			}
		};
	}

	private JMenu getUtilitiesMenu() {
		JMenuItem menuItem;
		JMenu utilities = new JMenu(Messages.getString("CollectEarthMenu.2")); //$NON-NLS-1$

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.18")); //$NON-NLS-1$
		menuItem.addActionListener(new MissingPlotsListener(frame, localPropertiesService, missingPlotService));
		serverMenuItems.add(menuItem); // This menu should only be shown if the DB is local ( not if Collect Earth is
		// acting as a client )

		utilities.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthMenu.3")); //$NON-NLS-1$
		menuItem.addActionListener(e -> {
			FileDividerToolDlg.open(frame, earthSurveyService.getCollectSurvey());
		});
		serverMenuItems.add(menuItem); // This menu should only be shown if the DB is local ( not if Collect Earth is // acting as a client )
		utilities.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthMenu.10")); //$NON-NLS-1$
		menuItem.addActionListener(e -> {
			removePlotsFromDBDlg.open(frame, earthSurveyService.getCollectSurvey());
		});
		utilities.add(menuItem);
		return utilities;
	}

	private JMenu getFileMenu() {
		JMenu fileMenu = new JMenu(Messages.getString("CollectEarthWindow.10")); //$NON-NLS-1$

		JMenuItem menuItem = new JMenuItem(Messages.getString("CollectEarthMenu.0")); //$NON-NLS-1$
		menuItem.addActionListener(new ApplyOptionChangesListener(this.getFrame(), localPropertiesService) {

			@Override
			protected void applyProperties() {
				final File[] selectedProjectFile = FileChooserUtils.getFileChooserResults(
						DataFormat.PROJECT_DEFINITION_FILE, false, false, null, localPropertiesService,
						getFrame() );

				if (selectedProjectFile != null && selectedProjectFile.length == 1) {
					try {
						if (selectedProjectFile[0].exists() && selectedProjectFile[0].canRead()) {
							earthProjectsService.loadCompressedProjectFile(selectedProjectFile[0]);
							restartEarth();
						} else {
							JOptionPane.showMessageDialog(getFrame(), 
								"Project file not accessible: " + selectedProjectFile[0].getAbsolutePath(),
								"File Access Error", JOptionPane.ERROR_MESSAGE);
						}
					} catch (Exception e1) {
						String errorMessage = e1.getMessage() != null ? e1.getMessage() : "Unknown error occurred";
						JOptionPane.showMessageDialog( getFrame(), errorMessage,
								Messages.getString("OptionWizard.51"), JOptionPane.ERROR_MESSAGE);
						logger.error("Error importing project file " + selectedProjectFile[0].getAbsolutePath(), e1);
					}
				}
			}
		});
		fileMenu.add(menuItem);
		this.add(fileMenu);
		fileMenu.addSeparator();
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.11")); //$NON-NLS-1$
		menuItem.addActionListener(collectEarthWindow.getCloseActionListener());
		menuItem.setIcon( FontIcon.of( MaterialDesign.MDI_LOGOUT ) );
		fileMenu.add(menuItem);
		return fileMenu;
	}

	private void addImportExportMenu(JMenu menu) {

		final JMenu ieSubmenu = new JMenu(Messages.getString("CollectEarthWindow.44")); //$NON-NLS-1$
		JMenuItem menuItem;
		
		final JMenu xmlExportSubmenu = new JMenu(Messages.getString("CollectEarthWindow.24")); //$NON-NLS-1$
		xmlExportSubmenu.setIcon( FontIcon.of( MaterialDesign.MDI_FILE_EXPORT ) );
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.45")); //$NON-NLS-1$
		menuItem.setIcon( FontIcon.of( MaterialDesign.MDI_FILE_XML ));
		menuItem.addActionListener(getExportActionListener(DataFormat.ZIP_WITH_XML, RecordsToExport.ALL));
		xmlExportSubmenu.add(menuItem);

		final JMenuItem exportModifiedRecords = new JMenuItem(Messages.getString("CollectEarthWindow.61")); //$NON-NLS-1$
		exportModifiedRecords.addActionListener(
				getExportActionListener(DataFormat.ZIP_WITH_XML, RecordsToExport.MODIFIED_SINCE_LAST_EXPORT));
		xmlExportSubmenu.add(exportModifiedRecords);

		final JMenuItem exportDataRangeRecords = new JMenuItem(Messages.getString("CollectEarthMenu.4")); //$NON-NLS-1$
		exportDataRangeRecords
		.addActionListener(getExportActionListener(DataFormat.ZIP_WITH_XML, RecordsToExport.PICK_FROM_DATE));
		xmlExportSubmenu.add(exportDataRangeRecords);

		ieSubmenu.add(xmlExportSubmenu);

		final JMenu backupExportSubmenu = new JMenu(Messages.getString("CollectEarthMenu.5")); //$NON-NLS-1$

		final JMenuItem exportDataBackup = new JMenuItem(Messages.getString("CollectEarthMenu.6")); //$NON-NLS-1$
		exportDataBackup.addActionListener(getExportActionListener(DataFormat.COLLECT_BACKUP, RecordsToExport.ALL));
		backupExportSubmenu.add(exportDataBackup);

		final JMenuItem exportDataRangeBackup = new JMenuItem(Messages.getString("CollectEarthMenu.7")); //$NON-NLS-1$
		exportDataRangeBackup
		.addActionListener(getExportActionListener(DataFormat.COLLECT_BACKUP, RecordsToExport.PICK_FROM_DATE));
		backupExportSubmenu.add(exportDataRangeBackup);

		ieSubmenu.add(backupExportSubmenu);
		
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.73")); //$NON-NLS-1$
		menuItem.addActionListener(getExportActionListener(DataFormat.KML_FILE, RecordsToExport.ALL));
		ieSubmenu.add(menuItem);

		ieSubmenu.addSeparator();

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.46")); //$NON-NLS-1$
		menuItem.addActionListener(getImportActionListener(DataFormat.ZIP_WITH_XML));
		ieSubmenu.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.55")); //$NON-NLS-1$
		menuItem.addActionListener(getImportActionListener(DataFormat.CSV));
		
		ieSubmenu.add(menuItem);

		menu.add(ieSubmenu);
		
		ieSubmenu.addSeparator();
		
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.13")); //$NON-NLS-1$
		menuItem.setIcon( FontIcon.of( MaterialDesign.MDI_FILE_DELIMITED ));
		menuItem.addActionListener(getExportActionListener(DataFormat.CSV, RecordsToExport.ALL));
		ieSubmenu.add(menuItem);


		serverMenuItems.add(ieSubmenu); // This menu should only be shown if the DB is local ( not if Collect Earth is
		// acting as a client )
	}

	private String getDisclaimerFilePath() {
		final String suffixLang = localPropertiesService.getUiLanguage().getLocale().getLanguage();
		final String localizedDisclaimer = RESOURCES_FOLDER + File.separator + 
				DISCLAIMER_FILENAME_PREFIX + suffixLang + DISCLAIMER_FILENAME_SUFFIX;
		
		if (new File(localizedDisclaimer).exists()) {
			return localizedDisclaimer;
		} else {
			return RESOURCES_FOLDER + File.separator + DISCLAIMER_DEFAULT;
		}
	}

	public ActionListener getExportActionListener(final DataFormat exportFormat, final RecordsToExport xmlExportType) {
		Objects.requireNonNull(exportFormat, "Export format cannot be null");
		Objects.requireNonNull(xmlExportType, "Export type cannot be null");
		
		return new ExportActionListener(exportFormat, xmlExportType, getFrame(), localPropertiesService,
				dataImportExportService, earthSurveyService, kmlGeneratorService);
	}

	private ActionListener getImportActionListener(final DataFormat importFormat) {
		Objects.requireNonNull(importFormat, "Import format cannot be null");
		
		return new ImportActionListener(importFormat, getFrame(), localPropertiesService, dataImportExportService);
	}

	private JMenu getLanguageMenu() {

		final ActionListener actionLanguage = e -> {
			try {
				final String langName = ((JRadioButtonMenuItem) e.getSource()).getName();
				final UI_LANGUAGE language = UI_LANGUAGE.valueOf(langName);
				CollectEarthUtils.setFontDependingOnLanguaue(language);
				localPropertiesService.setUiLanguage(language);

				SwingUtilities.invokeLater( () -> {
					getFrame().getContentPane().removeAll();
					getFrame().dispose();
					collectEarthWindow.openWindow();
				});

			} catch (final Exception ex) {
				logger.error("Error while changing language", ex); //$NON-NLS-1$
			} 
		};

		final JMenu menuLanguage = new JMenu(Messages.getString("CollectEarthWindow.2")); //$NON-NLS-1$
		menuLanguage.setIcon( FontIcon.of( MaterialDesign.MDI_TRANSLATE ));
		final ButtonGroup group = new ButtonGroup();
		final UI_LANGUAGE[] languages = UI_LANGUAGE.values();

		for (final UI_LANGUAGE language : languages) {
			final JRadioButtonMenuItem langItem = new JRadioButtonMenuItem(language.getLabel());
			langItem.setName(language.name());
			langItem.addActionListener(actionLanguage);
			menuLanguage.add(langItem);
			group.add(langItem);
			if (localPropertiesService.getUiLanguage().equals(language)) {
				langItem.setSelected(true);
			}

		}

		return menuLanguage;
	}

	public ActionListener getPropertiesAction(final JFrame owner) {
		Objects.requireNonNull(owner, "Owner frame cannot be null");

		return e -> {
			try {
				final JDialog dialog = new PropertiesDialog(owner, localPropertiesService, earthProjectsService,
						backupSqlLiteService.getAutomaticBackUpFolder().getPath(), analysisSaikuService,
						earthSurveyService.getCollectSurvey());
				dialog.setVisible(true);
				dialog.pack();
			} catch (Exception ex) {
				logger.error("Failed to open Properties dialog", ex);
				JOptionPane.showMessageDialog(owner,
					"Failed to open Properties dialog.\n\n" +
					"Error: " + ex.getClass().getSimpleName() + "\n" +
					"Message: " + (ex.getMessage() != null ? ex.getMessage() : "No details available") + "\n\n" +
					"Please check the log file for more details.",
					"Properties Dialog Error",
					JOptionPane.ERROR_MESSAGE);
			} catch (Error err) {
				logger.error("Critical error opening Properties dialog", err);
				JOptionPane.showMessageDialog(owner,
					"Critical error opening Properties dialog.\n\n" +
					"Error: " + err.getClass().getName() + "\n" +
					"Message: " + (err.getMessage() != null ? err.getMessage() : "No details available") + "\n\n" +
					"This may be due to missing or incompatible Java runtime components.\n" +
					"Please check the log file and ensure you're using a compatible JRE.",
					"Properties Dialog Critical Error",
					JOptionPane.ERROR_MESSAGE);
			}
		};
	}

	private ActionListener getSaikuAnalysisActionListener() {
		return new GenerateRDBAnalysisListener(getFrame(), new GenerateDatabaseStarter(analysisSaikuService, getFrame() ) );
	}
	
	private ActionListener getSaikuToolExportActionListener() {
		return new SaikuToolExportListener(getFrame(), new GenerateDatabaseStarter(analysisSaikuService, getFrame() ), localPropertiesService);
	}
	

	private ActionListener getIPCCExportActionListener() {
		return new IPCCGeneratorListener(getFrame(), new GenerateDatabaseStarter(ipccGeneratorService, getFrame() ) );
	}
	
	private String getLogFilePath() {
		return FolderFinder.getCollectEarthDataFolder() + File.separator + LOG_FILENAME;
	}

	public JFrame getFrame() {
		return frame;
	}

	public void setFrame(JFrame frame) {
		this.frame = frame;
	}

	private void showErrorDialog(String message, Exception ex) {
		logger.error(message, ex);
		String displayMessage = ex.getMessage() != null ? ex.getMessage() : UNKNOWN_ERROR_MESSAGE;
		JOptionPane.showMessageDialog(frame, displayMessage, 
			Messages.getString("CollectEarthWindow.63"), JOptionPane.ERROR_MESSAGE);
	}
	
	public List<JMenuItem> getServerMenuItems() {
		return serverMenuItems;
	}
}

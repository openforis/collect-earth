package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import javax.annotation.PostConstruct;
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

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.LoggerContext;
import org.apache.logging.log4j.core.config.Configuration;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.logging.JSwingAppender;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.BackupSqlLiteService;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.KmlImportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.MissingPlotService;
import org.openforis.collect.earth.app.view.ExportActionListener.RecordsToExport;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class CollectEarthMenu extends JMenuBar {

	@Autowired
	private DataImportExportService dataImportExportService;

	@Autowired
	private KmlImportService kmlImportService;

	@Autowired
	private MissingPlotService missingPlotService;

	@Autowired
	private AnalysisSaikuService analysisSaikuService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private CollectEarthWindow collectEarthWindow;

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private EarthProjectsService earthProjectsService;

	@Autowired
	private BackupSqlLiteService backupSqlLiteService;
	
	@Autowired
	private RemovePlotsFromDBDlg removePlotsFromDBDlg;
	
	@Autowired
	private EarthProjectsService projectsService;
	
	private static final long serialVersionUID = -2457052260968029351L;
	private final List<JMenuItem> serverMenuItems = new ArrayList<JMenuItem>();
	private JFrame frame;
	private final org.slf4j.Logger logger = LoggerFactory.getLogger(CollectEarthMenu.class);

	public CollectEarthMenu() {
		// Where the GUI is created:
		super();
	}

	@PostConstruct
	public void init() {
		setFrame(collectEarthWindow.getFrame());

		// Build file menu in the menu bar.
		this.add( getFileMenu() );

		// Build tools menu in the menu bar.
		this.add(getToolsMenu());

		// Build help menu in the menu bar.
		this.add(getHelpMenu());

	}

	public JMenu getHelpMenu() {
		JMenu menuHelp = new JMenu(Messages.getString("CollectEarthWindow.16")); //$NON-NLS-1$

		JMenuItem menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.56")); //$NON-NLS-1$
		menuItem.addActionListener(new OpenAboutDialogListener(frame, Messages.getString("CollectEarthWindow.62"))); //$NON-NLS-1$
		menuHelp.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.17")); //$NON-NLS-1$
		menuItem.addActionListener(
				new OpenTextFileListener(frame, getDisclaimerFilePath(), Messages.getString("CollectEarthWindow.4")));//$NON-NLS-1$
		menuHelp.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.50")); //$NON-NLS-1$
		menuItem.addActionListener(new OpenUserManualListener());
		menuHelp.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.64")); //$NON-NLS-1$
		menuItem.addActionListener(new OpenSupportForum());
		menuHelp.add(menuItem);

		menuHelp.addSeparator();

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.52")); //$NON-NLS-1$
		menuItem.addActionListener(
				new OpenTextFileListener(frame, getLogFilePath(), Messages.getString("CollectEarthWindow.53"))); //$NON-NLS-1$
		menuHelp.add(menuItem);
		
		JCheckBoxMenuItem checkboxErrors = new JCheckBoxMenuItem("Show exception errors", localPropertiesService.isExceptionShown() ); //$NON-NLS-1$
		checkboxErrors.addActionListener(
				new ActionListener() {
					// This sets/unsets the property that is checked when an exception is catch by the JSwingAppender log4j2 appender 
					@Override
					public void actionPerformed(ActionEvent e) {
						Boolean showException = checkboxErrors.isSelected();
						localPropertiesService.setExceptionShown( showException );
						
						final LoggerContext ctx = (LoggerContext) LogManager.getContext(false);
				        final Configuration config = ctx.getConfiguration();
						
						JSwingAppender jSwingAppender = config.getAppender("jswing-log");
						
						jSwingAppender.setExceptionShown( showException );
						
					}
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

		JMenuItem menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.14")); //$NON-NLS-1$
		menuItem.addActionListener(getSaikuAnalysisActionListener());
		toolsMenu.add(menuItem);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.54")); //$NON-NLS-1$
		menuItem.addActionListener(new ApplyOptionChangesListener(this.getFrame(), localPropertiesService) {

			@Override
			protected void applyProperties() {

				try {
					if (kmlImportService.prompToOpenKml(getFrame())) {
						restartEarth();
					}
				} catch (Exception e1) {
					JOptionPane.showMessageDialog(getFrame(), e1.getMessage(),
							Messages.getString("CollectEarthWindow.63"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
					logger.error("Error importing KML file", e1); //$NON-NLS-1$
				}

			}

		});
		serverMenuItems.add(menuItem); // This menu should only be shown if the DB is local ( not if Collect Earth is
		// acting as a client )
		toolsMenu.add(menuItem);

		menuItem = new JMenuItem("Open data folder"); //$NON-NLS-1$
		menuItem.addActionListener(new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				try {
					CollectEarthUtils.openFolderInExplorer(FolderFinder.getCollectEarthDataFolder());
				} catch (IOException e1) {
					logger.error("Could not find the data folder", e1);
				}

			}
		});
		serverMenuItems.add(menuItem); // This menu should only be shown if the DB is local ( not if Collect Earth is
		// acting as a client )
		toolsMenu.add(menuItem);

		toolsMenu.addSeparator();

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.15")); //$NON-NLS-1$
		menuItem.addActionListener(getPropertiesAction(frame));
		toolsMenu.add(menuItem);
		toolsMenu.add(getUtilitiesMenu() );

		toolsMenu.addSeparator();
		toolsMenu.add(getLanguageMenu());
		return toolsMenu;
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
		menuItem.addActionListener(new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				FileDividerToolDlg.open(frame, earthSurveyService.getCollectSurvey());
			}
		});
		serverMenuItems.add(menuItem); // This menu should only be shown if the DB is local ( not if Collect Earth is // acting as a client )
		utilities.add(menuItem);
		
		menuItem = new JMenuItem("Delete Plots from DB using CSV");
		menuItem.addActionListener(new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				removePlotsFromDBDlg.open(frame, earthSurveyService.getCollectSurvey());
			}
		});
		utilities.add(menuItem);
		

		utilities.add(menuItem);
		return utilities;
	}

	private JMenu getFileMenu() {
		JMenu fileMenu = new JMenu(Messages.getString("CollectEarthWindow.10")); //$NON-NLS-1$

		JMenuItem menuItem = new JMenuItem(Messages.getString("CollectEarthMenu.0")); //$NON-NLS-1$
		menuItem.addActionListener(new ApplyOptionChangesListener(this.getFrame(), localPropertiesService) {

			@Override
			protected void applyProperties() {
				final File[] selectedProjectFile = JFileChooserExistsAware.getFileChooserResults(
						DataFormat.PROJECT_DEFINITION_FILE, false, false, null, localPropertiesService,
						getFrame() );

				if (selectedProjectFile != null && selectedProjectFile.length == 1) {
					try {
						projectsService.loadCompressedProjectFile(selectedProjectFile[0]);

						restartEarth();
					} catch (Exception e1) {
						JOptionPane.showMessageDialog( getFrame(), e1.getMessage(),
								Messages.getString("OptionWizard.51"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
						logger.error("Error importing project file " + selectedProjectFile[0].getAbsolutePath(), e1); //$NON-NLS-1$
					}
				}
			}
		});
		fileMenu.add(menuItem);
		this.add(fileMenu);
		fileMenu.addSeparator();
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.11")); //$NON-NLS-1$
		menuItem.addActionListener(collectEarthWindow.getCloseActionListener());
		fileMenu.add(menuItem);
		return fileMenu;
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

		serverMenuItems.add(ieSubmenu); // This menu should only be shown if the DB is local ( not if Collect Earth is
		// acting as a client )
	}

	private String getDisclaimerFilePath() {
		final String suffix_lang = localPropertiesService.getUiLanguage().getLocale().getLanguage();
		if (new File("resources/disclaimer_" + suffix_lang + ".txt").exists()) { //$NON-NLS-1$ //$NON-NLS-2$
			return "resources/disclaimer_" + suffix_lang + ".txt";
		} else {
			return "resources/disclaimer_en.txt";
		}
	}

	private ActionListener getExportActionListener(final DataFormat exportFormat, final RecordsToExport xmlExportType) {
		return new ExportActionListener(exportFormat, xmlExportType, getFrame(), localPropertiesService,
				dataImportExportService, earthSurveyService);
	}

	private ActionListener getImportActionListener(final DataFormat importFormat) {
		return new ImportActionListener(importFormat, getFrame(), localPropertiesService, dataImportExportService);
	}

	private JMenu getLanguageMenu() {

		final ActionListener actionLanguage = new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent e) {
				try {
					final String langName = ((JRadioButtonMenuItem) e.getSource()).getName();
					final UI_LANGUAGE language = UI_LANGUAGE.valueOf(langName);
					CollectEarthUtils.setFontDependingOnLanguaue(language);
					localPropertiesService.setUiLanguage(language);

					SwingUtilities.invokeLater(new Thread("Resseting main CE Window") {
						@Override
						public void run() {

							getFrame().getContentPane().removeAll();
							getFrame().dispose();

							collectEarthWindow.openWindow();
						};
					});

				} catch (final Exception ex) {
					ex.printStackTrace();
					logger.error("Error while changing language", ex); //$NON-NLS-1$
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
			if (localPropertiesService.getUiLanguage().equals(language)) {
				langItem.setSelected(true);
			}

		}

		return menuLanguage;
	}

	private ActionListener getPropertiesAction(final JFrame owner) {
		return new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent e) {
				final JDialog dialog = new PropertiesDialog(owner, localPropertiesService, earthProjectsService,
						backupSqlLiteService.getAutomaticBackUpFolder().getPath(), analysisSaikuService,
						earthSurveyService.getCollectSurvey());
				dialog.setVisible(true);
				dialog.pack();
			}
		};
	}

	private ActionListener getSaikuAnalysisActionListener() {
		return new SaikuAnalysisListener(getFrame(), getSaikuStarter());
	}

	private SaikuStarter getSaikuStarter() {
		return new SaikuStarter(analysisSaikuService, getFrame());

	}


	private String getLogFilePath() {
		return FolderFinder.getCollectEarthDataFolder() + "/earth_error.log"; //$NON-NLS-1$
	}


	public JFrame getFrame() {
		return frame;
	}

	public void setFrame(JFrame frame) {
		this.frame = frame;
	}

	public List<JMenuItem> getServerMenuItems() {
		return serverMenuItems;
	}
}

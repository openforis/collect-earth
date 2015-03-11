package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Container;
import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;

import javax.swing.AbstractAction;
import javax.swing.AbstractButton;
import javax.swing.ButtonGroup;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JRadioButton;
import javax.swing.JScrollPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextField;
import javax.swing.ListSelectionModel;
import javax.swing.ScrollPaneConstants;
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;
import javax.swing.border.TitledBorder;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.event.ListSelectionEvent;
import javax.swing.event.ListSelectionListener;

import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
public class OptionWizard extends JDialog {

	private static final long serialVersionUID = -6760020609229102842L;

	private final HashMap<Enum<?>, JComponent[]> propertyToComponent = new HashMap<Enum<?>, JComponent[]>();
	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	JPanel postgresPanel;

	LocalPropertiesService localPropertiesService;
	String backupFolder;

	private AnalysisSaikuService saikuService;

	private EarthProjectsService projectsService;

	public OptionWizard(JFrame frame, LocalPropertiesService localPropertiesService, EarthProjectsService projectsService,  String backupFolder, AnalysisSaikuService saikuService) {
		super(frame, Messages.getString("OptionWizard.0")); //$NON-NLS-1$
		this.localPropertiesService = localPropertiesService;
		this.projectsService = projectsService;
		this.backupFolder = backupFolder;
		this.saikuService = saikuService;
		this.setLocationRelativeTo(null);
		this.setSize(new Dimension(600, 620));
		this.setModal(true);
		this.setResizable(false);
		initilizeInputs();
		buildMainPane();
	}

	private void buildMainPane() {

		final JPanel panel = new JPanel(new BorderLayout());
		panel.add(getOptionTabs(), BorderLayout.CENTER);
		final JPanel buttonPanel = new JPanel();
		buttonPanel.add(getApplyChangesButton());
		buttonPanel.add(getCancelButton());
		panel.add(buttonPanel, BorderLayout.PAGE_END);
		this.add(panel);

	}

	public void enableContainer(Container container, boolean enable) {
		final Component[] components = container.getComponents();
		for (final Component component : components) {
			component.setEnabled(enable);
			if (component instanceof Container) {
				enableContainer((Container) component, enable);
			}
		}
	}


	private JComponent getAdvancedOptionsPanel() {
		final JPanel panel = new JPanel(new GridBagLayout());
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;

		constraints.gridx = 0;
		constraints.gridwidth = 2;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_EARTH_ENGINE)[0], constraints);

		constraints.gridy++;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_TIMELAPSE)[0], constraints);

		constraints.gridy++;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_BING_MAPS)[0], constraints);
		
		constraints.gridy++;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_HERE_MAPS)[0], constraints);
		
		constraints.gridy++;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_GEE_PLAYGROUND)[0], constraints);

		final JPanel browserChooserPanel = new JPanel();
		final Border browserBorder = new TitledBorder(new BevelBorder(BevelBorder.LOWERED), Messages.getString("OptionWizard.1")); //$NON-NLS-1$
		browserChooserPanel.setBorder(browserBorder);

		final ButtonGroup browserChooser = new ButtonGroup();
		final JComponent[] browsers = propertyToComponent.get(EarthProperty.BROWSER_TO_USE);
		for (final JComponent broserRadioButton : browsers) {
			browserChooserPanel.add(broserRadioButton);
			browserChooser.add((AbstractButton) broserRadioButton);
		}
		constraints.gridy++;
		panel.add(browserChooserPanel, constraints);

		constraints.gridy++;
		constraints.gridx = 0;
		panel.add(propertyToComponent.get(EarthProperty.FIREFOX_BINARY_PATH)[0], constraints);

		constraints.gridy++;
		constraints.gridx = 0;
		panel.add(propertyToComponent.get(EarthProperty.CHROME_BINARY_PATH)[0], constraints);

		constraints.gridy++;
		constraints.gridx = 0;
		panel.add(propertyToComponent.get(EarthProperty.SAIKU_SERVER_FOLDER)[0], constraints);

		return panel;
	}

	private Component getApplyChangesButton() {
		final JButton applyChanges = new JButton(Messages.getString("OptionWizard.15")); //$NON-NLS-1$
		applyChanges.addActionListener(new ApplyOptionChangesListener(this, localPropertiesService, propertyToComponent){
			@Override
			protected void applyProperties() {

				savePropertyValues();
				restartEarth();
			}

		});

		return applyChanges;
	}

	private Component getCancelButton() {
		final JButton cancelButton = new JButton(Messages.getString("OptionWizard.24")); //$NON-NLS-1$
		cancelButton.addActionListener(new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent arg0) {
				OptionWizard.this.dispose();
			}
		});
		return cancelButton;
	}

	
	private String getComputerIp() {
		try {
			return InetAddress.getLocalHost().getHostAddress();
		} catch (final UnknownHostException e) {
			logger.warn("Unknown IP address", e); //$NON-NLS-1$
			return Messages.getString("OptionWizard.11"); //$NON-NLS-1$
		}
	}

	private JComponent getOperationModePanel() {
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;

		final JPanel typeOfUsePanel = new JPanel(new GridBagLayout());
		final Border border = new TitledBorder(new BevelBorder(BevelBorder.LOWERED), Messages.getString("OptionWizard.2")); //$NON-NLS-1$
		typeOfUsePanel.setBorder(border);

		JPanel serverPanel = getServerPanel();


		typeOfUsePanel.add(serverPanel, constraints);


		return typeOfUsePanel;
	}

	private ActionListener getDbTypeListener() {
		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				final JRadioButton theJRB = (JRadioButton) e.getSource();

				boolean isPostgreDb = theJRB.getName().equals(CollectDBDriver.POSTGRESQL.name() );
				enableContainer(postgresPanel, isPostgreDb);
			}
		};
	}

	private JTabbedPane getOptionTabs() {
		final JTabbedPane tabbedPane = new JTabbedPane();
		tabbedPane.setSize(550, 300);
		final JComponent panel1 = getSampleDataPanel();
		tabbedPane.addTab(Messages.getString("OptionWizard.31"), panel1); //$NON-NLS-1$

		final JComponent panel2 = getPlotOptionsPanel();
		tabbedPane.addTab(Messages.getString("OptionWizard.32"), panel2); //$NON-NLS-1$

		final JComponent panel3 = getSurveyDefinitonPanel();
		tabbedPane.addTab(Messages.getString("OptionWizard.33"), panel3); //$NON-NLS-1$

		final JComponent panel4 = getAdvancedOptionsPanel();
		tabbedPane.addTab(Messages.getString("OptionWizard.34"), panel4); //$NON-NLS-1$

		final JComponent panel5 = getOperationModePanelScroll();
		tabbedPane.addTab(Messages.getString("OptionWizard.25"), panel5); //$NON-NLS-1$

		final JComponent panel6 = getProjectsPanelScroll();
		tabbedPane.addTab(Messages.getString("OptionWizard.40"), panel6); //$NON-NLS-1$

		return tabbedPane;
	}

	private JComponent getProjectsPanelScroll() {
		final JComponent projectsPanel = getProjectsPanel();
		JScrollPane scroll = new JScrollPane(projectsPanel, JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED, JScrollPane.HORIZONTAL_SCROLLBAR_NEVER);
		return scroll;
	}

	private JComponent getProjectsPanel() {
		final JPanel panel = new JPanel(new GridBagLayout());
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.fill = GridBagConstraints.BOTH;

		JButton importNewButton = new JButton( Messages.getString("OptionWizard.41") ); //$NON-NLS-1$
		importNewButton.addActionListener( new ApplyOptionChangesListener(this, localPropertiesService) {

			@Override
			protected void applyProperties() {
				final File[] selectedProjectFile = JFileChooserExistsAware.getFileChooserResults(
						DataFormat.PROJECT_DEFINITION_FILE, false, false, 
						null,localPropertiesService,
						(JFrame) OptionWizard.this.getParent());

				if( selectedProjectFile.length == 1 ){
					try {
						projectsService.loadCompressedProjectFile( selectedProjectFile[0]);

						restartEarth();						
					} catch (Exception e1) {
						JOptionPane.showMessageDialog( OptionWizard.this, e1.getMessage(), Messages.getString("OptionWizard.51"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
						logger.error("Error importing project file " + selectedProjectFile[0].getAbsolutePath(), e1); //$NON-NLS-1$
					}

				}
			}
		});

		panel.add(importNewButton, constraints);



		
		final JPanel typeOfDbPanel = new JPanel(new GridBagLayout());
		final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED), Messages.getString("OptionWizard.57")); //$NON-NLS-1$
		typeOfDbPanel.setBorder(border);
		
		constraints.gridx = 0;
		constraints.gridy = 1;
		panel.add(typeOfDbPanel, constraints);

		List<String> listOfProjectsByName = new ArrayList<String>();
		listOfProjectsByName.addAll(projectsService.getProjectList().keySet());
		Collections.sort(listOfProjectsByName);
		final JList<String> listOfProjects = new JList<String>( listOfProjectsByName.toArray(new String[0]) ); //data has type Object[]
		listOfProjects.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
		listOfProjects.setLayoutOrientation(JList.VERTICAL);
		listOfProjects.setVisibleRowCount(-1);

		JScrollPane listScroller = new JScrollPane(listOfProjects);
		listScroller.setPreferredSize(new Dimension(250, 300));
		
		constraints.gridy = 0;
		constraints.gridx = GridBagConstraints.RELATIVE;
		typeOfDbPanel.add(listScroller, constraints);
		
		final JButton openProject = new JButton(Messages.getString("OptionWizard.56")); //$NON-NLS-1$
		openProject.setEnabled(false);
		openProject.addActionListener( new ApplyOptionChangesListener(this, localPropertiesService) {

			@Override
			protected void applyProperties() {
				
				File projectFolder = projectsService.getProjectList().get( listOfProjects.getSelectedValue());

				try {
					projectsService.loadProjectInFolder( projectFolder );
					restartEarth();						
				} catch (Exception e1) {
					JOptionPane.showMessageDialog( OptionWizard.this, e1.getMessage(), Messages.getString("OptionWizard.55"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
					logger.error("Error importing project folder " + projectFolder.getAbsolutePath(), e1); //$NON-NLS-1$
				}

			}

		});
		
		listOfProjects.addListSelectionListener( new ListSelectionListener() {
			
			@Override
			public void valueChanged(ListSelectionEvent e) {
				openProject.setEnabled( listOfProjects.getSelectedValue() != null );
			}
		});

		typeOfDbPanel.add(openProject);
				

		return panel;
	}

	private JScrollPane getOperationModePanelScroll() {
		final JComponent operationModePanel = getOperationModePanel();
		JScrollPane scroll = new JScrollPane(operationModePanel, JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED, JScrollPane.HORIZONTAL_SCROLLBAR_NEVER);
		return scroll;
	}

	private JComponent getPlotOptionsPanel() {
		final JPanel panel = new JPanel(new GridBagLayout());
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.fill = GridBagConstraints.HORIZONTAL;

		JLabel label = new JLabel(Messages.getString("OptionWizard.35")); //$NON-NLS-1$
		panel.add(label, constraints);

		constraints.gridx = 1;
		panel.add(propertyToComponent.get(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT)[0], constraints);

		constraints.gridx = 0;
		constraints.gridy = 1;
		label = new JLabel(Messages.getString("OptionWizard.36")); //$NON-NLS-1$
		panel.add(label, constraints);

		constraints.gridx = 1;
		panel.add(new JScrollPane(propertyToComponent.get(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)[0]), constraints);

		constraints.gridx = 0;
		constraints.gridy = 2;
		label = new JLabel(Messages.getString("OptionWizard.37")); //$NON-NLS-1$
		panel.add(label, constraints);
		constraints.gridx = 1;
		panel.add(new JScrollPane(propertyToComponent.get(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES)[0]), constraints);
		return panel;
	}

	private JPanel getPostgreSqlPanel() {
		final JPanel panel = new JPanel(new GridBagLayout());
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;

		final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED), Messages.getString("OptionWizard.6")); //$NON-NLS-1$
		panel.setBorder(border);

		JLabel label = new JLabel(Messages.getString("OptionWizard.7")); //$NON-NLS-1$
		constraints.gridx = 0;
		panel.add(label, constraints);

		constraints.gridx = 1;
		panel.add(propertyToComponent.get(EarthProperty.DB_USERNAME)[0], constraints);

		constraints.gridy++;
		label = new JLabel(Messages.getString("OptionWizard.8")); //$NON-NLS-1$
		constraints.gridx = 0;
		panel.add(label, constraints);

		constraints.gridx = 1;
		panel.add(propertyToComponent.get(EarthProperty.DB_PASSWORD)[0], constraints);

		constraints.gridy++;
		label = new JLabel(Messages.getString("OptionWizard.9")); //$NON-NLS-1$
		constraints.gridx = 0;
		panel.add(label, constraints);

		constraints.gridx = 1;
		panel.add(propertyToComponent.get(EarthProperty.DB_NAME)[0], constraints);


		constraints.gridy++;
		label = new JLabel(Messages.getString("OptionWizard.26")); //$NON-NLS-1$
		constraints.gridx = 0;
		panel.add(label, constraints);

		constraints.gridx = 1;
		panel.add(propertyToComponent.get(EarthProperty.DB_HOST)[0], constraints);

		constraints.gridy++;
		label = new JLabel(Messages.getString("OptionWizard.29")); //$NON-NLS-1$
		constraints.gridx = 0;
		panel.add(label, constraints);

		constraints.gridx = 1;
		panel.add(propertyToComponent.get(EarthProperty.DB_PORT)[0], constraints);

		return panel;
	}

	private JPanel getSqlLitePanel() {
		final JPanel panel = new JPanel(new GridBagLayout());
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;

		final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED), Messages.getString("OptionWizard.30")); //$NON-NLS-1$
		panel.setBorder(border);

		panel.add(propertyToComponent.get(EarthProperty.AUTOMATIC_BACKUP)[0], constraints);
		constraints.gridx++;
		panel.add(getOpenBackupFolderButton() );
		return panel;
	}

	private JComponent getSampleDataPanel() {
		final JPlotCsvTable samplePlots = new JPlotCsvTable( localPropertiesService.getValue(EarthProperty.CSV_KEY) );

		final JPanel panel = new JPanel(new GridBagLayout());
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.fill = GridBagConstraints.BOTH;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;

		final JFilePicker refreshTableOnFileChange = getFilePickerSamplePlots(samplePlots);

		panel.add(refreshTableOnFileChange, constraints);

		samplePlots.setFillsViewportHeight(true);
		constraints.gridy = 1;

		constraints.weightx = 1.0;
		constraints.weighty = 1.0;
		constraints.gridwidth = GridBagConstraints.REMAINDER;
		constraints.gridheight = GridBagConstraints.REMAINDER;

		samplePlots.setPreferredScrollableViewportSize(samplePlots.getPreferredSize());

		panel.add(new JScrollPane(samplePlots, ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED),
				constraints);

		return panel;
	}

	private JFilePicker getFilePickerSamplePlots(final JPlotCsvTable samplePlots) {
		final JFilePicker refreshTableOnFileChange = (JFilePicker) (propertyToComponent.get(EarthProperty.CSV_KEY)[0]);
		refreshTableOnFileChange.addChangeListener(new DocumentListener() {

			@Override
			public void changedUpdate(DocumentEvent e) {
				refreshTable();
			}

			@Override
			public void insertUpdate(DocumentEvent e) {
				refreshTable();
			}
			
			@Override
			public void removeUpdate(DocumentEvent e) {
				refreshTable();
			}
			
			private void refreshTable() {
				samplePlots.refreshTable(refreshTableOnFileChange.getSelectedFilePath());
			}
		});
		return refreshTableOnFileChange;
	}



	private JPanel getServerPanel() {

		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;

		final JPanel typeOfDbPanel = new JPanel(new GridBagLayout());
		final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED), Messages.getString("OptionWizard.3")); //$NON-NLS-1$
		typeOfDbPanel.setBorder(border);

		JLabel label = new JLabel(Messages.getString("OptionWizard.4") + getComputerIp()); //$NON-NLS-1$
		typeOfDbPanel.add(label, constraints);
		constraints.gridy++;

		label = new JLabel(Messages.getString("OptionWizard.5")); //$NON-NLS-1$
		constraints.gridx = 0;
		typeOfDbPanel.add(label, constraints);

		constraints.gridx = 1;
		typeOfDbPanel.add(propertyToComponent.get(EarthProperty.HOST_PORT_KEY)[0], constraints);

		constraints.gridwidth = GridBagConstraints.REMAINDER;
		constraints.gridy++;
		constraints.gridx = 0;

		final ButtonGroup bg = new ButtonGroup();
		final JComponent[] dbTypes = propertyToComponent.get(EarthProperty.DB_DRIVER);

		postgresPanel = getPostgreSqlPanel();
		JPanel sqlitePanel = getSqlLitePanel();

		for (final JComponent typeRadioButton : dbTypes) {
			final JRadioButton dbTypeButton = (JRadioButton) typeRadioButton;
			bg.add(dbTypeButton);
			typeOfDbPanel.add(dbTypeButton, constraints);
			constraints.gridy++;

			dbTypeButton.addActionListener(getDbTypeListener());

			if (dbTypeButton.getName().equals(EarthConstants.CollectDBDriver.POSTGRESQL.name() ) ) {
				typeOfDbPanel.add(postgresPanel, constraints);
				constraints.gridy++;
			}else{
				typeOfDbPanel.add(sqlitePanel, constraints);
				constraints.gridy++;
			}
		}
		return typeOfDbPanel;
	}

	private Component getOpenBackupFolderButton() {

		AbstractAction backupAction = new AbstractAction(Messages.getString("OptionWizard.10") ){ //$NON-NLS-1$

			private static final long serialVersionUID = 1L;

			@Override
			public void actionPerformed(ActionEvent e) {
				try {

					if (SystemUtils.IS_OS_WINDOWS){
						new ProcessBuilder("explorer.exe", "/select," + backupFolder).start(); //$NON-NLS-1$ //$NON-NLS-2$
					}else if (SystemUtils.IS_OS_MAC){
						new ProcessBuilder("usr/bin/open", backupFolder).start(); //$NON-NLS-1$ //$NON-NLS-2$
					}else if ( SystemUtils.IS_OS_UNIX){

						try {
							new ProcessBuilder("nautilus", backupFolder).start(); //$NON-NLS-1$ //$NON-NLS-2$
						} catch (Exception e1) {
							try {
								new ProcessBuilder("gnome-open", backupFolder).start(); //$NON-NLS-1$ //$NON-NLS-2$
							} catch (Exception e2) {
								try {
									new ProcessBuilder("kde-open", backupFolder).start(); //$NON-NLS-1$ //$NON-NLS-2$
								} catch (Exception e3) {
									new ProcessBuilder("caja", backupFolder).start(); //$NON-NLS-1$ //$NON-NLS-2$
								}
							}
						}

					}

				} catch (final IOException e1) {
					logger.error("Error when opening the explorer window to visualize backups", e1); //$NON-NLS-1$
				}
			}
		};

		return new JButton( backupAction );

	}

	private JComponent getSurveyDefinitonPanel() {
		final JPanel panel = new JPanel(new GridBagLayout());
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.fill = GridBagConstraints.HORIZONTAL;
		constraints.gridwidth = 2;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_BALLOON_IN_BROWSER)[0], constraints);

		constraints.gridy++;
		constraints.gridwidth = 1;
		final JLabel label = new JLabel(Messages.getString("OptionWizard.43")); //$NON-NLS-1$
		panel.add(label, constraints);
		constraints.gridx = 1;
		panel.add(propertyToComponent.get(EarthProperty.SURVEY_NAME)[0], constraints);

		constraints.gridy++;
		constraints.gridwidth = GridBagConstraints.REMAINDER;
		constraints.gridx = 0;
		panel.add(propertyToComponent.get(EarthProperty.KML_TEMPLATE_KEY)[0], constraints);

		constraints.gridy++;
		constraints.gridx = 0;
		panel.add(propertyToComponent.get(EarthProperty.BALLOON_TEMPLATE_KEY)[0], constraints);

		constraints.gridy++;
		constraints.gridx = 0;

		panel.add(propertyToComponent.get(EarthProperty.METADATA_FILE)[0], constraints);

		return panel;
	}

	private void initilizeInputs() {

		final JCheckBox backupCheckbox = new JCheckBox(Messages.getString("OptionWizard.44")); //$NON-NLS-1$
		backupCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.AUTOMATIC_BACKUP)));
		propertyToComponent.put(EarthProperty.AUTOMATIC_BACKUP, new JComponent[] { backupCheckbox });

		final JCheckBox openEarthEngineCheckbox = new JCheckBox(Messages.getString("OptionWizard.45")); //$NON-NLS-1$
		openEarthEngineCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_EARTH_ENGINE)));
		propertyToComponent.put(EarthProperty.OPEN_EARTH_ENGINE, new JComponent[] { openEarthEngineCheckbox });

		final JCheckBox openTimelapseCheckbox = new JCheckBox(Messages.getString("OptionWizard.46")); //$NON-NLS-1$
		openTimelapseCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_TIMELAPSE)));
		propertyToComponent.put(EarthProperty.OPEN_TIMELAPSE, new JComponent[] { openTimelapseCheckbox });

		final JCheckBox openBingCheckbox = new JCheckBox(Messages.getString("OptionWizard.47")); //$NON-NLS-1$
		openBingCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_BING_MAPS)));
		propertyToComponent.put(EarthProperty.OPEN_BING_MAPS, new JComponent[] { openBingCheckbox });
		
		final JCheckBox openHereCheckbox = new JCheckBox(Messages.getString("OptionWizard.59")); //$NON-NLS-1$
		openHereCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_HERE_MAPS)));
		propertyToComponent.put(EarthProperty.OPEN_HERE_MAPS, new JComponent[] { openHereCheckbox });
		
		final JCheckBox openGeePlaygroundCheckbox = new JCheckBox(Messages.getString("OptionWizard.58")); //$NON-NLS-1$
		openGeePlaygroundCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_GEE_PLAYGROUND)));
		propertyToComponent.put(EarthProperty.OPEN_GEE_PLAYGROUND, new JComponent[] { openGeePlaygroundCheckbox });


		final JCheckBox openInSeparateWindowCheckbox = new JCheckBox(Messages.getString("OptionWizard.48")); //$NON-NLS-1$
		openInSeparateWindowCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_BALLOON_IN_BROWSER)));
		propertyToComponent.put(EarthProperty.OPEN_BALLOON_IN_BROWSER, new JComponent[] { openInSeparateWindowCheckbox });

		final JFilePicker csvWithPlotData = new JFilePicker(
				Messages.getString("OptionWizard.49"), localPropertiesService.getValue(EarthProperty.CSV_KEY), //$NON-NLS-1$
				Messages.getString("OptionWizard.50")); //$NON-NLS-1$
		csvWithPlotData.setMode(JFilePicker.MODE_OPEN);

		csvWithPlotData.addFileTypeFilter(".csv,.ced", Messages.getString("OptionWizard.52"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.CSV_KEY, new JComponent[] { csvWithPlotData });

		final JComboBox<ComboBoxItem> comboNumberOfPoints = new JComboBox<ComboBoxItem>(
				new ComboBoxItem[] {
						new ComboBoxItem(0, Messages.getString("OptionWizard.53")), new ComboBoxItem(1, Messages.getString("OptionWizard.54")), new ComboBoxItem(4, "2x2"), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
						new ComboBoxItem(9, "3x3"), new ComboBoxItem(16, "4x4"), new ComboBoxItem(25, "5x5"), new ComboBoxItem(36, "6x6"), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
						new ComboBoxItem(49, "7x7") }); //$NON-NLS-1$
		comboNumberOfPoints.setSelectedItem(new ComboBoxItem(Integer.parseInt(localPropertiesService
				.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT)), "")); //$NON-NLS-1$
		propertyToComponent.put(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT, new JComponent[] { comboNumberOfPoints });

		final String[] listOfNumbers = new String[995];
		final int offset = 5;
		for (int index = 0; index < listOfNumbers.length; index++) {
			listOfNumbers[index] = (index + offset) + ""; //$NON-NLS-1$
		}

		// JTextField listOfDistanceBetweenPoints = new JTextField( localPropertiesService.getValue( EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS) );
		final JComboBox<String> listOfDistanceBetweenPoints = new JComboBox<String>(listOfNumbers);
		listOfDistanceBetweenPoints.setSelectedItem(localPropertiesService.getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS));
		listOfDistanceBetweenPoints.setAutoscrolls(true);

		propertyToComponent.put(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS, new JComponent[] { listOfDistanceBetweenPoints });

		// JTextField listOfDistanceToBorder = new JTextField(localPropertiesService.getValue( EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES) );
		final JComboBox<String> listOfDistanceToBorder = new JComboBox<String>(listOfNumbers);
		listOfDistanceToBorder.setSelectedItem(localPropertiesService.getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES));
		listOfDistanceToBorder.setAutoscrolls(true);

		propertyToComponent.put(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, new JComponent[] { listOfDistanceToBorder });

		final JRadioButton chromeChooser = new JRadioButton("Chrome"); //$NON-NLS-1$
		chromeChooser.setSelected(localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim().equals(EarthConstants.CHROME_BROWSER));
		chromeChooser.setName(EarthConstants.CHROME_BROWSER);

		final JRadioButton firefoxChooser = new JRadioButton("Firefox"); //$NON-NLS-1$
		firefoxChooser.setSelected(localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim().equals(EarthConstants.FIREFOX_BROWSER));
		firefoxChooser.setName(EarthConstants.FIREFOX_BROWSER);
		propertyToComponent.put(EarthProperty.BROWSER_TO_USE, new JComponent[] { firefoxChooser, chromeChooser });

		final JFilePicker saikuPath = new JFilePicker(Messages.getString("OptionWizard.65"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER), Messages.getString("OptionWizard.66")); //$NON-NLS-1$
		saikuPath.setMode(JFilePicker.MODE_OPEN);
		saikuPath.setFolderChooser();
		saikuPath.addChangeListener(new DocumentListener() {

			private void showSaikuWarning(){
				final File saikuFolder = new File(saikuPath.getSelectedFilePath());
				if( saikuFolder!=null && !saikuService.isSaikuFolder( saikuFolder )){
					JOptionPane.showMessageDialog( OptionWizard.this, Messages.getString("OptionWizard.27"), Messages.getString("OptionWizard.28"), JOptionPane.INFORMATION_MESSAGE ); //$NON-NLS-1$ //$NON-NLS-2$
					saikuPath.getTextField().setBackground(CollectEarthWindow.ERROR_COLOR);
				}else{
					saikuPath.getTextField().setBackground(Color.white);
				}
			}

			@Override
			public void removeUpdate(DocumentEvent e) {

			}

			@Override
			public void insertUpdate(DocumentEvent e) {
				showSaikuWarning();
			}

			@Override
			public void changedUpdate(DocumentEvent e) {

			}
		});
		propertyToComponent.put(EarthProperty.SAIKU_SERVER_FOLDER, new JComponent[] { saikuPath });

		final JFilePicker firefoxBinaryPath = new JFilePicker(Messages.getString("OptionWizard.67"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.FIREFOX_BINARY_PATH), Messages.getString("OptionWizard.68")); //$NON-NLS-1$
		firefoxBinaryPath.setMode(JFilePicker.MODE_OPEN);
		firefoxBinaryPath.addFileTypeFilter(".exe", Messages.getString("OptionWizard.70"), true); //$NON-NLS-1$ //$NON-NLS-2$
		firefoxBinaryPath.addFileTypeFilter(".bin", Messages.getString("OptionWizard.72"), false); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.FIREFOX_BINARY_PATH, new JComponent[] { firefoxBinaryPath });

		final JFilePicker chromeBinaryPath = new JFilePicker(Messages.getString("OptionWizard.73"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.CHROME_BINARY_PATH), Messages.getString("OptionWizard.74")); //$NON-NLS-1$
		chromeBinaryPath.setMode(JFilePicker.MODE_OPEN);
		chromeBinaryPath.addFileTypeFilter(".exe", Messages.getString("OptionWizard.76"), true); //$NON-NLS-1$ //$NON-NLS-2$
		chromeBinaryPath.addFileTypeFilter(".bin", Messages.getString("OptionWizard.78"), false); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.CHROME_BINARY_PATH, new JComponent[] { chromeBinaryPath });

		final JFilePicker kmlTemplatePath = new JFilePicker(Messages.getString("OptionWizard.79"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.KML_TEMPLATE_KEY), Messages.getString("OptionWizard.80")); //$NON-NLS-1$
		kmlTemplatePath.setMode(JFilePicker.MODE_OPEN);
		kmlTemplatePath.addFileTypeFilter(".fmt", Messages.getString("OptionWizard.82"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.KML_TEMPLATE_KEY, new JComponent[] { kmlTemplatePath });

		final JFilePicker htmlBalloonPath = new JFilePicker(Messages.getString("OptionWizard.83"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.BALLOON_TEMPLATE_KEY), Messages.getString("OptionWizard.84")); //$NON-NLS-1$
		htmlBalloonPath.setMode(JFilePicker.MODE_OPEN);
		htmlBalloonPath.addFileTypeFilter(".html,.htm", Messages.getString("OptionWizard.86"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.BALLOON_TEMPLATE_KEY, new JComponent[] { htmlBalloonPath });

		final JFilePicker idmPath = new JFilePicker(
				Messages.getString("OptionWizard.87"), localPropertiesService.getImdFile(), //$NON-NLS-1$
				Messages.getString("OptionWizard.88")); //$NON-NLS-1$
		idmPath.setMode(JFilePicker.MODE_OPEN);
		idmPath.addFileTypeFilter(".xml", Messages.getString("OptionWizard.90"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.METADATA_FILE, new JComponent[] { idmPath });

		final JTextField surveyNameTextField = new JTextField(localPropertiesService.getValue(EarthProperty.SURVEY_NAME));
		surveyNameTextField.setEnabled(false);
		propertyToComponent.put(EarthProperty.SURVEY_NAME, new JComponent[] { surveyNameTextField });

		// Database options

		final JRadioButton instanceTypeServer = new JRadioButton(Messages.getString("OptionWizard.91")); //$NON-NLS-1$ 
		instanceTypeServer.setSelected(localPropertiesService.getOperationMode().equals( OperationMode.SERVER_MODE ) );
		instanceTypeServer.setName(EarthConstants.OperationMode.SERVER_MODE.name());

		final JRadioButton instanceTypeClient = new JRadioButton(Messages.getString("OptionWizard.92")); //$NON-NLS-1$
		instanceTypeClient.setSelected( localPropertiesService.getOperationMode().equals( OperationMode.CLIENT_MODE )  );
		instanceTypeClient.setName(EarthConstants.OperationMode.CLIENT_MODE.name());
		propertyToComponent.put(EarthProperty.OPERATION_MODE, new JComponent[] { instanceTypeServer, instanceTypeClient });

		final JTextField collectEarthServerIp = new JTextField(localPropertiesService.getValue(EarthProperty.HOST_KEY));
		propertyToComponent.put(EarthProperty.HOST_KEY, new JComponent[] { collectEarthServerIp });

		final JTextField collectEarthServerIpPort = new JTextField( localPropertiesService.getPort() );
		final JTextField collectEarthServerLocalPort = new JTextField(localPropertiesService.getValue(EarthProperty.HOST_PORT_KEY));
		propertyToComponent.put(EarthProperty.HOST_PORT_KEY, new JComponent[] { collectEarthServerIpPort, collectEarthServerLocalPort });

		final JRadioButton sqliteDbType = new JRadioButton(Messages.getString("OptionWizard.93")); //$NON-NLS-1$
		sqliteDbType.setSelected(localPropertiesService.getCollectDBDriver().equals(CollectDBDriver.SQLITE));
		sqliteDbType.setName(CollectDBDriver.SQLITE.name());

		final JRadioButton postgresDbType = new JRadioButton(Messages.getString("OptionWizard.94")); //$NON-NLS-1$
		postgresDbType.setSelected(localPropertiesService.getCollectDBDriver().equals(CollectDBDriver.POSTGRESQL));
		postgresDbType.setName(CollectDBDriver.POSTGRESQL.name());
		propertyToComponent.put(EarthProperty.DB_DRIVER, new JComponent[] { sqliteDbType, postgresDbType });

		final JTextField dbUserName = new JTextField(localPropertiesService.getValue(EarthProperty.DB_USERNAME));
		propertyToComponent.put(EarthProperty.DB_USERNAME, new JComponent[] { dbUserName });

		final JTextField dbPassword = new JTextField(localPropertiesService.getValue(EarthProperty.DB_PASSWORD));
		propertyToComponent.put(EarthProperty.DB_PASSWORD, new JComponent[] { dbPassword });

		final JTextField dbName = new JTextField(localPropertiesService.getValue(EarthProperty.DB_NAME));
		propertyToComponent.put(EarthProperty.DB_NAME, new JComponent[] { dbName });

		final JTextField dbHost = new JTextField(localPropertiesService.getValue(EarthProperty.DB_HOST));
		propertyToComponent.put(EarthProperty.DB_HOST, new JComponent[] { dbHost });

		final JTextField dbPort = new JTextField(localPropertiesService.getValue(EarthProperty.DB_PORT));
		propertyToComponent.put(EarthProperty.DB_PORT, new JComponent[] { dbPort });

	}

}

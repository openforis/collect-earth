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
import java.beans.PropertyChangeListener;
import java.io.File;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.HashMap;
import java.util.Set;
import java.util.Vector;

import javax.swing.AbstractAction;
import javax.swing.AbstractButton;
import javax.swing.Action;
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
import javax.swing.JTable;
import javax.swing.JTextField;
import javax.swing.ScrollPaneConstants;
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;
import javax.swing.border.TitledBorder;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.table.DefaultTableModel;
import javax.swing.text.JTextComponent;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.PlotProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class OptionWizard extends JDialog {

	private static final long serialVersionUID = -6760020609229102842L;
	
	private HashMap<EarthProperty, JComponent[]> propertyToComponent = new HashMap<EarthProperty, JComponent[]>();
	private Logger logger = LoggerFactory.getLogger(this.getClass());

	LocalPropertiesService localPropertiesService;
	
	String backupFolder;
	
	private void endWaiting(){
		this.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.DEFAULT_CURSOR));
	}
	private void startWaiting(){
		this.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.WAIT_CURSOR));
	}
	
	public OptionWizard(JFrame frame, LocalPropertiesService localPropertiesService, String backupFolder) {
		super(frame, Messages.getString("OptionWizard.0")); //$NON-NLS-1$
		this.localPropertiesService = localPropertiesService;
		this.backupFolder = backupFolder;
		this.setLocationRelativeTo(frame);
		this.setSize(new Dimension(600, 420));
		this.setModal(true);
		this.setResizable(false);
		initilizeInputs();
		buildMainPane();
	}

	private void buildMainPane() {

		JPanel panel = new JPanel(new BorderLayout());

		panel.add(getOptionTabs(), BorderLayout.CENTER);

		JPanel buttonPanel = new JPanel();
		buttonPanel.add(getApplyChangesButton());
		buttonPanel.add(getCancelButton());

		panel.add(buttonPanel, BorderLayout.PAGE_END);
		
		this.add(panel);

	}

	private JComponent getAdvancedOptionsPanel() {
		JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;

		panel.add(propertyToComponent.get(EarthProperty.AUTOMATIC_BACKUP)[0], constraints);
		constraints.gridx++;
		panel.add( new JButton( new AbstractAction("Show backup folder") {
			
			@Override
			public void actionPerformed(ActionEvent e) {

				try {
					Process p = new ProcessBuilder("explorer.exe", "/select," + backupFolder).start();
				} catch (IOException e1) {
					logger.error("Error when opening the explorer window to visualize backups", e);
				}
				
			}
		} ), constraints);
		
		
		constraints.gridx = 0;
		constraints.gridwidth =2;
		constraints.gridy++;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_EARTH_ENGINE)[0], constraints);

		constraints.gridy++;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_TIMELAPSE)[0], constraints);
		
		constraints.gridy++;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_BING_MAPS)[0], constraints);
		
		JPanel browserChooserPanel = new JPanel();
		Border browserBorder = new TitledBorder(new BevelBorder(BevelBorder.LOWERED), Messages.getString("OptionWizard.1")); //$NON-NLS-1$
		browserChooserPanel.setBorder(browserBorder);

		ButtonGroup browserChooser = new ButtonGroup();
		JComponent[] browsers = propertyToComponent.get(EarthProperty.BROWSER_TO_USE);
		for (JComponent broserRadioButton : browsers) {
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

	private JComponent getDatabaseServerPanel() {
		
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;
			
		JPanel typeOfUsePanel = new JPanel(new GridBagLayout() );
		Border border = new TitledBorder(new BevelBorder(BevelBorder.LOWERED), Messages.getString("OptionWizard.2")); //$NON-NLS-1$
		typeOfUsePanel.setBorder(border);

		ButtonGroup typeChooser = new ButtonGroup();
		JComponent[] browsers = propertyToComponent.get(EarthProperty.INSTANCE_TYPE);
		final JPanel clientPanel =  getClientPanel();
		final JPanel serverPanel =  getServerPanel();
		for (JComponent typeRadioButton : browsers) {
			JRadioButton intanceButton =	(JRadioButton)typeRadioButton ;
			typeChooser.add( intanceButton );
			typeOfUsePanel.add( intanceButton, constraints  );
			constraints.gridy++;
			
			intanceButton.addActionListener( getClientInstanceListener(clientPanel, serverPanel));

			if( intanceButton.getName().equals( EarthConstants.INSTANCE_TYPE.CLIENT_INSTANCE.name() ) ){
				typeOfUsePanel.add( clientPanel, constraints );
			}else{
				intanceButton.setSelected(true);
				typeOfUsePanel.add( serverPanel , constraints );
			}
			constraints.gridy++;
			
		}

		return typeOfUsePanel;
	}
	private JPanel getServerPanel() {
		
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;
			
		JPanel typeOfDbPanel = new JPanel(new GridBagLayout());
		Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED), Messages.getString("OptionWizard.3")); //$NON-NLS-1$
		typeOfDbPanel.setBorder(border);

		JLabel label = new JLabel(Messages.getString("OptionWizard.4") + getComputerIp()); //$NON-NLS-1$
		typeOfDbPanel.add(label, constraints);
		constraints.gridy++;
		
		label = new JLabel(Messages.getString("OptionWizard.5")); //$NON-NLS-1$
		constraints.gridx = 0;
		typeOfDbPanel.add(label, constraints);
		
		constraints.gridx = 1;
		typeOfDbPanel.add(propertyToComponent.get(EarthProperty.PORT_KEY)[0], constraints);
		
		constraints.gridy++;
		constraints.gridx = 0;
		
		
				
		ButtonGroup bg = new ButtonGroup();
		JComponent[] dbTypes = propertyToComponent.get(EarthProperty.DB_DRIVER);
		
		final JPanel postgresqlPanel =  getPostgreSqlPanel();
		for (JComponent typeRadioButton : dbTypes) {
			JRadioButton dbTypeButton =	(JRadioButton)typeRadioButton ;
			bg.add( dbTypeButton );
			typeOfDbPanel.add( dbTypeButton, constraints );
			constraints.gridy++;
			
			dbTypeButton.addActionListener( getDbTypeListener(postgresqlPanel ));

			if( dbTypeButton.getName().equals( EarthConstants.DB_DRIVER.POSTGRESQL.getDriverClass() ) ){
				typeOfDbPanel.add( postgresqlPanel, constraints );
				constraints.gridy++;
			}
		}
		
		return typeOfDbPanel;
	}
	private ActionListener getDbTypeListener(final JPanel postgresqlPanel) {
		return new ActionListener() {
			
			@Override
			public void actionPerformed(ActionEvent e) {
				JRadioButton theJRB = (JRadioButton) e.getSource();
		        enableComponents( postgresqlPanel, theJRB.getName().equals( EarthConstants.DB_DRIVER.POSTGRESQL.getDriverClass() ));
			}
		};
	}
	private JPanel getPostgreSqlPanel() {
		JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;
			
		
		Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED), Messages.getString("OptionWizard.6")); //$NON-NLS-1$
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
		
		
		return panel;
	}
	private String getComputerIp() {
		try {
			return InetAddress.getLocalHost().getHostAddress();
		} catch (UnknownHostException e) {
			logger.warn("Unknown IP address", e); //$NON-NLS-1$
			return Messages.getString("OptionWizard.11"); //$NON-NLS-1$
		}
	}
	private ActionListener getClientInstanceListener(final JPanel clientPanel, final JPanel serverPanel) {
		return new ActionListener() {
			
			@Override
			public void actionPerformed(ActionEvent e) {
				JRadioButton theJRB = (JRadioButton) e.getSource();
		        enableComponents( clientPanel, theJRB.getName().equals( EarthConstants.INSTANCE_TYPE.CLIENT_INSTANCE.name() ));
		        enableComponents( serverPanel, !theJRB.getName().equals( EarthConstants.INSTANCE_TYPE.CLIENT_INSTANCE.name() ));
			}
		};
	}
	
	public void enableComponents(Container container, boolean enable) {
        Component[] components = container.getComponents();
        for (Component component : components) {
            component.setEnabled(enable);
            if (component instanceof Container) {
                enableComponents((Container)component, enable);
            }
        }
    }
	
	
	private JPanel getClientPanel() {
		JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;
			
		
		Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED), Messages.getString("OptionWizard.12")); //$NON-NLS-1$
		panel.setBorder(border);

		JLabel label = new JLabel(Messages.getString("OptionWizard.13")); //$NON-NLS-1$
		panel.add(label, constraints);

		constraints.gridx = 1;
		panel.add(propertyToComponent.get(EarthProperty.HOST_KEY)[0], constraints);

		
		constraints.gridy++;
		label = new JLabel(Messages.getString("OptionWizard.14")); //$NON-NLS-1$
		constraints.gridx = 0;
		panel.add(label, constraints);

		constraints.gridx = 1;
		panel.add(propertyToComponent.get(EarthProperty.PORT_KEY)[1], constraints);
		
		return panel;
	}
	
	private Component getApplyChangesButton() {
		final JButton applyChanges = new JButton(Messages.getString("OptionWizard.15")); //$NON-NLS-1$
		applyChanges.addActionListener(new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent arg0) {
				try{
					startWaiting();
					applyProperties();
				}catch(Exception e ){
					logger.error("Error applying the new properties", e ); //$NON-NLS-1$
				} finally{
					endWaiting();
				}
			}

			private void applyProperties() {
				Set<EarthProperty> keySet = propertyToComponent.keySet();
				for (EarthProperty earthProperty : keySet) {
					JComponent component = propertyToComponent.get(earthProperty)[0];
					if (component instanceof JTextComponent) {
						localPropertiesService.setValue(earthProperty, ((JTextComponent) component).getText());
					} else if (component instanceof JCheckBox) {
						localPropertiesService.setValue(earthProperty, ((JCheckBox) component).isSelected() + ""); //$NON-NLS-1$
					} else if (component instanceof JComboBox) {
						if (((JComboBox) component).getItemAt(0) instanceof ComboBoxItem) {
							localPropertiesService.setValue(earthProperty,
									((ComboBoxItem) ((JComboBox) component).getSelectedItem()).getNumberOfPoints() + ""); //$NON-NLS-1$
						} else {
							localPropertiesService.setValue(earthProperty, (String) ((JComboBox) component).getSelectedItem());
						}
					} else if (component instanceof JList) {
						localPropertiesService.setValue(earthProperty, ((JList) component).getSelectedValue() + ""); //$NON-NLS-1$
					} else if (component instanceof JRadioButton) {
						JComponent[] jComponents = propertyToComponent.get(earthProperty);
						for (JComponent jComponent : jComponents) {
							if (((JRadioButton) jComponent).isSelected()) {
								localPropertiesService.setValue(earthProperty, ((JRadioButton) jComponent).getName());
							}
						}
					} else if (component instanceof JFilePicker) {
						localPropertiesService.setValue(earthProperty, ((JFilePicker) component).getSelectedFilePath());
					}
				}

				localPropertiesService.nullifyChecksumValues();

				try {
					EarthApp earthApp = new EarthApp(localPropertiesService);
					// Re-generate KMZ
					earthApp.generateKmzFile();
					// Re-open the KMZ file in Google Earth
					earthApp.simulateClickKmz();

					JOptionPane
							.showMessageDialog(
									OptionWizard.this,
									Messages.getString("OptionWizard.20"), //$NON-NLS-1$
									Messages.getString("OptionWizard.21"), JOptionPane.INFORMATION_MESSAGE); //$NON-NLS-1$
					OptionWizard.this.dispose();

				} catch (IOException e) {
					logger.error("Error when re-generating the KML code to open in GE ", e); //$NON-NLS-1$
					JOptionPane.showMessageDialog(OptionWizard.this, null, Messages.getString("OptionWizard.23"), //$NON-NLS-1$
							JOptionPane.WARNING_MESSAGE);
				}
			}
		});

		return applyChanges;
	}

	private Component getCancelButton() {
		JButton cancelButton = new JButton(Messages.getString("OptionWizard.24")); //$NON-NLS-1$
		cancelButton.addActionListener(new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent arg0) {
				OptionWizard.this.dispose();
			}
		});
		return cancelButton;
	}

	private Vector<String> getColumnNames() {
		Vector<String> columns = new Vector<String>();
		columns.add(Messages.getString("OptionWizard.16")); //$NON-NLS-1$
		columns.add(Messages.getString("OptionWizard.17")); //$NON-NLS-1$
		columns.add(Messages.getString("OptionWizard.18")); //$NON-NLS-1$
		columns.add(Messages.getString("OptionWizard.19")); //$NON-NLS-1$
		columns.add(Messages.getString("OptionWizard.22")); //$NON-NLS-1$
		columns.add("Aspect"); //$NON-NLS-1$
		return columns;
	}

	private JTabbedPane getOptionTabs() {
		JTabbedPane tabbedPane = new JTabbedPane();
		tabbedPane.setSize(550, 300);
		JComponent panel1 = getSampleDataPanel();
		tabbedPane.addTab(Messages.getString("OptionWizard.31"), panel1); //$NON-NLS-1$

		JComponent panel2 = getPlotOptionsPanel();
		tabbedPane.addTab(Messages.getString("OptionWizard.32"), panel2); //$NON-NLS-1$

		JComponent panel3 = getSurveyDefinitonPanel();
		tabbedPane.addTab(Messages.getString("OptionWizard.33"), panel3); //$NON-NLS-1$

		JComponent panel4 = getAdvancedOptionsPanel();
		tabbedPane.addTab(Messages.getString("OptionWizard.34"), panel4); //$NON-NLS-1$
		
		/*
		JComponent panel5 = getDatabaseServerPanel();
		tabbedPane.addTab("Database ( Server/Client )", panel5);
		*/
		return tabbedPane;
	}

	private JComponent getPlotOptionsPanel() {
		JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
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

	private JComponent getSampleDataPanel() {
		final JTable samplePlots = new JTable(getSamplingPoints(localPropertiesService.getValue(EarthProperty.CSV_KEY)), getColumnNames());

		JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;
		constraints.gridwidth = GridBagConstraints.REMAINDER;
		panel.add(propertyToComponent.get(EarthProperty.CSV_KEY)[0], constraints);

		final JFilePicker jFilePicker = (JFilePicker) (propertyToComponent.get(EarthProperty.CSV_KEY)[0]);
		jFilePicker.addChangeListener(new DocumentListener() {

			@Override
			public void changedUpdate(DocumentEvent e) {
				refreshTable();
			}

			@Override
			public void insertUpdate(DocumentEvent e) {
				refreshTable();
			}

			private void refreshTable() {
				samplePlots.removeAll();
				File csvFile = new File(jFilePicker.getSelectedFilePath());
				boolean errorLoading = false;
				if (csvFile.exists()) {
					Vector<Vector<Object>> samplingPoints = getSamplingPoints(jFilePicker.getSelectedFilePath());
					if (samplingPoints.size() == 0) {
						errorLoading = true;
					} else {
						samplePlots.setModel(new DefaultTableModel(samplingPoints, getColumnNames()));
					}
				} else {
					errorLoading = true;
				}

				if (errorLoading) {
					samplePlots.setBackground(CollectEarthWindow.ERROR_COLOR);
					samplePlots.setModel(new DefaultTableModel());
				} else {
					samplePlots.setBackground(Color.white);
				}
			}

			@Override
			public void removeUpdate(DocumentEvent e) {
				refreshTable();
			}
		});

		samplePlots.setFillsViewportHeight(true);
		constraints.gridy = 1;
		constraints.fill = GridBagConstraints.BOTH;
		constraints.fill = GridBagConstraints.BOTH;
		constraints.weightx = 1.0;
		constraints.weighty = 1.0;
		constraints.gridwidth = GridBagConstraints.REMAINDER;
		constraints.gridheight = GridBagConstraints.REMAINDER;
		samplePlots.setPreferredSize(new Dimension(300, 300));
		samplePlots.setPreferredScrollableViewportSize(samplePlots.getPreferredSize());

		panel.add(new JScrollPane(samplePlots, ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED),
				constraints);

		return panel;
	}

	private Vector<Vector<Object>> getSamplingPoints(String csvFilePath) {
		String[] csvRow;
		CSVReader reader = null;
		Vector<Vector<Object>> plots = new Vector<Vector<Object>>();
		try {
			boolean skip = true;
			reader = KmlGenerator.getCsvReader(csvFilePath);
			try {
				while ((csvRow = reader.readNext()) != null && plots.size() < 50) {
					if (skip) {
						// Skip first row, it might contain column names
						skip = false;
						continue;
					}

					PlotProperties plotProperties = KmlGenerator.getPlotProperties(csvRow);
					Vector<Object> props = new Vector<Object>();
					props.add(plotProperties.id);
					props.add(plotProperties.xCoord);
					props.add(plotProperties.yCoord);
					props.add(plotProperties.elevation);
					props.add(plotProperties.slope);
					props.add(plotProperties.aspect);

					plots.add(props);

				}
			} catch (Exception e) {
				JOptionPane.showMessageDialog(this,
						Messages.getString("OptionWizard.38") //$NON-NLS-1$
								+ Messages.getString("OptionWizard.39"), "Error reading file contents", //$NON-NLS-1$ //$NON-NLS-2$
						JOptionPane.ERROR_MESSAGE);
			}
		} catch (IOException e) {
			logger.error("Error when extracting data from CSV file " + csvFilePath, e); //$NON-NLS-1$
		} finally {
			if (reader != null) {
				try {
					reader.close();
				} catch (IOException e) {
					logger.error(Messages.getString("OptionWizard.42"), e); //$NON-NLS-1$
				}
			}
		}
		return plots;
	}

	private JComponent getSurveyDefinitonPanel() {
		JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.fill = GridBagConstraints.HORIZONTAL;
		constraints.gridwidth = 2;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_BALLOON_IN_BROWSER)[0], constraints);

		constraints.gridy++;
		constraints.gridwidth = 1;
		JLabel label = new JLabel(Messages.getString("OptionWizard.43")); //$NON-NLS-1$
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

		
		JCheckBox backupCheckbox = new JCheckBox(Messages.getString("OptionWizard.44") ); //$NON-NLS-1$
		backupCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.AUTOMATIC_BACKUP)));
		propertyToComponent.put(EarthProperty.AUTOMATIC_BACKUP, new JComponent[] { backupCheckbox });
		
		JCheckBox openEarthEngineCheckbox = new JCheckBox(Messages.getString("OptionWizard.45")); //$NON-NLS-1$
		openEarthEngineCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_EARTH_ENGINE)));
		propertyToComponent.put(EarthProperty.OPEN_EARTH_ENGINE, new JComponent[] { openEarthEngineCheckbox });

		JCheckBox openTimelapseCheckbox = new JCheckBox(Messages.getString("OptionWizard.46")); //$NON-NLS-1$
		openTimelapseCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_TIMELAPSE)));
		propertyToComponent.put(EarthProperty.OPEN_TIMELAPSE, new JComponent[] { openTimelapseCheckbox });

		JCheckBox openBingCheckbox = new JCheckBox(Messages.getString("OptionWizard.47")); //$NON-NLS-1$
		openBingCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_BING_MAPS)));
		propertyToComponent.put(EarthProperty.OPEN_BING_MAPS, new JComponent[] { openBingCheckbox });
		
		JCheckBox openInSeparateWindowCheckbox = new JCheckBox(Messages.getString("OptionWizard.48")); //$NON-NLS-1$
		openInSeparateWindowCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_BALLOON_IN_BROWSER)));
		propertyToComponent.put(EarthProperty.OPEN_BALLOON_IN_BROWSER, new JComponent[] { openInSeparateWindowCheckbox });

		JFilePicker csvWithPlotData = new JFilePicker(Messages.getString("OptionWizard.49"), localPropertiesService.getValue(EarthProperty.CSV_KEY), //$NON-NLS-1$
				Messages.getString("OptionWizard.50")); //$NON-NLS-1$
		csvWithPlotData.setMode(JFilePicker.MODE_OPEN);

		csvWithPlotData.addFileTypeFilter(".csv,.ced", Messages.getString("OptionWizard.52"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.CSV_KEY, new JComponent[] { csvWithPlotData });

		JComboBox comboNumberOfPoints = new JComboBox(new ComboBoxItem[] { new ComboBoxItem(0, Messages.getString("OptionWizard.53")), new ComboBoxItem(1, Messages.getString("OptionWizard.54")), new ComboBoxItem(4, "2x2"), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
				new ComboBoxItem(9, "3x3"), new ComboBoxItem(16, "4x4"), new ComboBoxItem(25, "5x5"), new ComboBoxItem(36, "6x6"), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
				new ComboBoxItem(49, "7x7") }); //$NON-NLS-1$
		comboNumberOfPoints.setSelectedItem(new ComboBoxItem(Integer.parseInt(localPropertiesService
				.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT)), "")); //$NON-NLS-1$
		propertyToComponent.put(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT, new JComponent[] { comboNumberOfPoints });

		String[] listOfNumbers = new String[995];
		int offset = 5;
		for (int index = 0; index < listOfNumbers.length; index++) {
			listOfNumbers[index] = (index + offset) + ""; //$NON-NLS-1$
		}

		// JTextField listOfDistanceBetweenPoints = new JTextField( localPropertiesService.getValue( EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS) );
		JComboBox listOfDistanceBetweenPoints = new JComboBox(listOfNumbers);
		listOfDistanceBetweenPoints.setSelectedItem(localPropertiesService.getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS));
		listOfDistanceBetweenPoints.setAutoscrolls(true);

		propertyToComponent.put(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS, new JComponent[] { listOfDistanceBetweenPoints });

		// JTextField listOfDistanceToBorder = new JTextField(localPropertiesService.getValue( EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES) );
		JComboBox listOfDistanceToBorder = new JComboBox(listOfNumbers);
		listOfDistanceToBorder.setSelectedItem(localPropertiesService.getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES));
		listOfDistanceToBorder.setAutoscrolls(true);

		propertyToComponent.put(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, new JComponent[] { listOfDistanceToBorder });

		JRadioButton chromeChooser = new JRadioButton("Chrome"); //$NON-NLS-1$
		chromeChooser.setSelected(localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim().equals(EarthConstants.CHROME_BROWSER));
		chromeChooser.setName(EarthConstants.CHROME_BROWSER);

		JRadioButton firefoxChooser = new JRadioButton("Firefox"); //$NON-NLS-1$
		firefoxChooser.setSelected(localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim()
				.equals(EarthConstants.FIREFOX_BROWSER));
		firefoxChooser.setName(EarthConstants.FIREFOX_BROWSER);
		propertyToComponent.put(EarthProperty.BROWSER_TO_USE, new JComponent[] { firefoxChooser, chromeChooser });
		
		
		JFilePicker saikuPath = new JFilePicker(Messages.getString("OptionWizard.65"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER), Messages.getString("OptionWizard.66")); //$NON-NLS-1$
		saikuPath.setMode(JFilePicker.MODE_OPEN);
		saikuPath.setFolderChooser();
		propertyToComponent.put(EarthProperty.SAIKU_SERVER_FOLDER, new JComponent[] { saikuPath });
		
		JFilePicker firefoxBinaryPath = new JFilePicker(Messages.getString("OptionWizard.67"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.FIREFOX_BINARY_PATH), Messages.getString("OptionWizard.68")); //$NON-NLS-1$
		firefoxBinaryPath.setMode(JFilePicker.MODE_OPEN);
		firefoxBinaryPath.addFileTypeFilter(".exe", Messages.getString("OptionWizard.70"), true); //$NON-NLS-1$ //$NON-NLS-2$
		firefoxBinaryPath.addFileTypeFilter(".bin", Messages.getString("OptionWizard.72"), false); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.FIREFOX_BINARY_PATH, new JComponent[] { firefoxBinaryPath });

		JFilePicker chromeBinaryPath = new JFilePicker(Messages.getString("OptionWizard.73"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.CHROME_BINARY_PATH), Messages.getString("OptionWizard.74")); //$NON-NLS-1$
		chromeBinaryPath.setMode(JFilePicker.MODE_OPEN);
		chromeBinaryPath.addFileTypeFilter(".exe", Messages.getString("OptionWizard.76"), true); //$NON-NLS-1$ //$NON-NLS-2$
		chromeBinaryPath.addFileTypeFilter(".bin", Messages.getString("OptionWizard.78"), false); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.CHROME_BINARY_PATH, new JComponent[] { chromeBinaryPath });
		

		JFilePicker kmlTemplatePath = new JFilePicker(Messages.getString("OptionWizard.79"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.KML_TEMPLATE_KEY), Messages.getString("OptionWizard.80")); //$NON-NLS-1$
		kmlTemplatePath.setMode(JFilePicker.MODE_OPEN);
		kmlTemplatePath.addFileTypeFilter(".fmt", Messages.getString("OptionWizard.82"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.KML_TEMPLATE_KEY, new JComponent[] { kmlTemplatePath });

		JFilePicker htmlBalloonPath = new JFilePicker(Messages.getString("OptionWizard.83"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.BALLOON_TEMPLATE_KEY), Messages.getString("OptionWizard.84")); //$NON-NLS-1$
		htmlBalloonPath.setMode(JFilePicker.MODE_OPEN);
		htmlBalloonPath.addFileTypeFilter(".html,.htm", Messages.getString("OptionWizard.86"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.BALLOON_TEMPLATE_KEY, new JComponent[] { htmlBalloonPath });

		JFilePicker idmPath = new JFilePicker(Messages.getString("OptionWizard.87"), localPropertiesService.getValue(EarthProperty.METADATA_FILE), //$NON-NLS-1$
				Messages.getString("OptionWizard.88")); //$NON-NLS-1$
		idmPath.setMode(JFilePicker.MODE_OPEN);
		idmPath.addFileTypeFilter(".xml", Messages.getString("OptionWizard.90"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.METADATA_FILE, new JComponent[] { idmPath });

		JTextField surveyNameTextField = new JTextField(localPropertiesService.getValue(EarthProperty.SURVEY_NAME));
		propertyToComponent.put(EarthProperty.SURVEY_NAME, new JComponent[] { surveyNameTextField });
		
		// Database options
		
		JRadioButton instanceTypeServer = new JRadioButton(Messages.getString("OptionWizard.91")); //$NON-NLS-1$
		instanceTypeServer.setSelected(localPropertiesService.getValue(EarthProperty.INSTANCE_TYPE).trim().equals(EarthConstants.INSTANCE_TYPE.SERVER_INSTANCE.name() ));
		instanceTypeServer.setName(EarthConstants.INSTANCE_TYPE.SERVER_INSTANCE.name());

		JRadioButton instanceTypeClient = new JRadioButton(Messages.getString("OptionWizard.92")); //$NON-NLS-1$
		instanceTypeClient.setSelected(localPropertiesService.getValue(EarthProperty.INSTANCE_TYPE).trim().equals(EarthConstants.INSTANCE_TYPE.CLIENT_INSTANCE.name()));
		instanceTypeClient.setName(EarthConstants.INSTANCE_TYPE.CLIENT_INSTANCE.name());
		propertyToComponent.put(EarthProperty.INSTANCE_TYPE, new JComponent[] { instanceTypeServer, instanceTypeClient });
		
		JTextField collectEarthServerIp = new JTextField(localPropertiesService.getValue(EarthProperty.HOST_KEY));
		propertyToComponent.put(EarthProperty.HOST_KEY, new JComponent[] { collectEarthServerIp });
		
		JTextField collectEarthServerIpPort = new JTextField(localPropertiesService.getValue(EarthProperty.PORT_KEY));
		JTextField collectEarthServerLocalPort = new JTextField(localPropertiesService.getValue(EarthProperty.PORT_KEY));
		propertyToComponent.put(EarthProperty.PORT_KEY, new JComponent[] { collectEarthServerIpPort, collectEarthServerLocalPort });
		
		JRadioButton sqliteDbType = new JRadioButton(Messages.getString("OptionWizard.93")); //$NON-NLS-1$
		sqliteDbType.setSelected(localPropertiesService.getValue(EarthProperty.DB_DRIVER).trim().equals(EarthConstants.DB_DRIVER.SQLITE.getDriverClass() ));
		sqliteDbType.setName(EarthConstants.DB_DRIVER.SQLITE.getDriverClass());

		JRadioButton postgresDbType = new JRadioButton(Messages.getString("OptionWizard.94")); //$NON-NLS-1$
		postgresDbType.setSelected(localPropertiesService.getValue(EarthProperty.DB_DRIVER).trim().equals( EarthConstants.DB_DRIVER.POSTGRESQL.getDriverClass() ));
		postgresDbType.setName(EarthConstants.DB_DRIVER.POSTGRESQL.getDriverClass());
		propertyToComponent.put(EarthProperty.DB_DRIVER, new JComponent[] { sqliteDbType, postgresDbType });
		
		
		JTextField dbUserName = new JTextField(localPropertiesService.getValue(EarthProperty.DB_USERNAME));
		propertyToComponent.put(EarthProperty.DB_USERNAME, new JComponent[] { dbUserName });
		
		JTextField dbPassword = new JTextField(localPropertiesService.getValue(EarthProperty.DB_PASSWORD));
		propertyToComponent.put(EarthProperty.DB_PASSWORD, new JComponent[] { dbPassword });
		
		JTextField dbName = new JTextField(localPropertiesService.getValue(EarthProperty.DB_NAME));
		propertyToComponent.put(EarthProperty.DB_NAME, new JComponent[] { dbName });
		
		
	}

}

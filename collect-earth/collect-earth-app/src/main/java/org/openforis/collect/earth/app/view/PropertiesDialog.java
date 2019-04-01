package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Container;
import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.Toolkit;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.io.IOException;
import java.text.DecimalFormat;
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

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.JFilePicker.DlgMode;
import org.openforis.collect.model.CollectSurvey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
public class PropertiesDialog extends JDialog {

	private static final ComboBoxItem COMBO_BOX_ITEM_CENTRAL_POINT = new ComboBoxItem(1,
			Messages.getString("OptionWizard.54"));

	private static final ComboBoxItem COMBO_BOX_ITEM_SQUARE = new ComboBoxItem(0,
			Messages.getString("OptionWizard.53"));

	private static final long serialVersionUID = -6760020609229102842L;

	private final HashMap<Enum<?>, JComponent[]> propertyToComponent = new HashMap<Enum<?>, JComponent[]>();
	private final transient  Logger logger = LoggerFactory.getLogger(this.getClass());

	JPanel postgresPanel;
	JPanel sqlitePanel;

	private transient LocalPropertiesService localPropertiesService;

	String backupFolder;

	private transient AnalysisSaikuService saikuService;

	private transient EarthProjectsService projectsService;

	private boolean restartRequired;

	private String oldSelectedDistance;

	private CollectSurvey surveyLoaded;

	private JButton applyChanges;

	public PropertiesDialog(JFrame frame, LocalPropertiesService localPropertiesService,
			EarthProjectsService projectsService, String backupFolder, AnalysisSaikuService saikuService,
			CollectSurvey surveyLoaded) {
		super(frame, Messages.getString("OptionWizard.0")); //$NON-NLS-1$
		this.localPropertiesService = localPropertiesService;
		this.projectsService = projectsService;
		this.backupFolder = backupFolder;
		this.saikuService = saikuService;
		this.surveyLoaded = surveyLoaded;
		this.setLocationRelativeTo(null);
		this.setSize(new Dimension(600, 620));
		this.setModal(true);
		this.setResizable(false);
		initilizeInputs();
		buildMainPane();
		centreWindow();

	}

	private void centreWindow() {
		Dimension dimension = Toolkit.getDefaultToolkit().getScreenSize();
		int x = (int) ((dimension.getWidth() - getWidth()) / 2);
		int y = (int) ((dimension.getHeight() - getHeight()) / 2);
		setLocation(x, y);
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

	private void enableContainer(Container container, boolean enable) {
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
		panel.add(propertyToComponent.get(EarthProperty.OPEN_YANDEX_MAPS)[0], constraints);
		
		constraints.gridy++;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_BAIDU_MAPS)[0], constraints);

		constraints.gridy++;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_STREET_VIEW)[0], constraints);

		constraints.gridy++;
		panel.add(propertyToComponent.get(EarthProperty.OPEN_GEE_PLAYGROUND)[0], constraints);

		final JPanel browserChooserPanel = new JPanel();
		final Border browserBorder = new TitledBorder(new BevelBorder(BevelBorder.LOWERED),
				Messages.getString("OptionWizard.1")); //$NON-NLS-1$
		browserChooserPanel.setBorder(browserBorder);

		final ButtonGroup browserChooser = new ButtonGroup();
		final JComponent[] browsers = propertyToComponent.get(EarthProperty.BROWSER_TO_USE);
		ActionListener restartListener = new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				setRestartRequired(true);

			}
		};
		for (final JComponent broserRadioButton : browsers) {
			browserChooserPanel.add(broserRadioButton);
			browserChooser.add((AbstractButton) broserRadioButton);

			((JRadioButton) broserRadioButton).addActionListener(restartListener);
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
		if (applyChanges == null) {
			applyChanges = new JButton(Messages.getString("OptionWizard.15"));
			applyChanges.addActionListener(
					new ApplyOptionChangesListener(this, localPropertiesService, propertyToComponent) {
						@Override
						protected void applyProperties() {
							savePropertyValues();
							if (isRestartRequired()) {
								
								restartEarth();
							} else {
								EarthApp.executeKmlLoadAsynchronously(PropertiesDialog.this);
							}
						}
					});
		}
		return applyChanges;
	}

	public void closeDialog() {
		this.dispose();
	}

	private Component getCancelButton() {
		final JButton cancelButton = new JButton(Messages.getString("OptionWizard.24")); //$NON-NLS-1$
		cancelButton.addActionListener( e -> PropertiesDialog.this.dispose() );
		return cancelButton;
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
		final Border border = new TitledBorder(new BevelBorder(BevelBorder.LOWERED),
				Messages.getString("OptionWizard.2")); //$NON-NLS-1$
		typeOfUsePanel.setBorder(border);

		JPanel serverPanel = getServerPanel();
		typeOfUsePanel.add(serverPanel, constraints);

		return typeOfUsePanel;
	}

	private void enableDBOptions(boolean isPostgreDb) {
		enableContainer(postgresPanel, isPostgreDb);
		enableContainer(sqlitePanel, !isPostgreDb);
	}

	private ActionListener getDbTypeListener() {
		return e -> {
				final JRadioButton theJRB = (JRadioButton) e.getSource();

				boolean isPostgreDb = theJRB.getName().equals(CollectDBDriver.POSTGRESQL.name());
				enableDBOptions(isPostgreDb);
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
		return new JScrollPane(projectsPanel, JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED, JScrollPane.HORIZONTAL_SCROLLBAR_NEVER);
	}

	private JComponent getProjectsPanel() {
		final JPanel panel = new JPanel(new GridBagLayout());
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.fill = GridBagConstraints.BOTH;

		JButton importNewButton = new JButton(Messages.getString("OptionWizard.41")); //$NON-NLS-1$
		importNewButton.addActionListener(new ApplyOptionChangesListener(this, localPropertiesService) {

			@Override
			protected void applyProperties() {
				final File[] selectedProjectFile = JFileChooserExistsAware.getFileChooserResults(
						DataFormat.PROJECT_DEFINITION_FILE, false, false, null, localPropertiesService,
						(JFrame) PropertiesDialog.this.getParent());

				if (selectedProjectFile != null && selectedProjectFile.length == 1) {
					try {
						projectsService.loadCompressedProjectFile(selectedProjectFile[0]);
						restartEarth();
					} catch (Exception e1) {
						JOptionPane.showMessageDialog(PropertiesDialog.this, e1.getMessage(),
								Messages.getString("OptionWizard.51"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
						logger.error("Error importing project file " + selectedProjectFile[0].getAbsolutePath(), e1); //$NON-NLS-1$
					}

				}
			}
		});

		panel.add(importNewButton, constraints);

		final JPanel typeOfDbPanel = new JPanel(new GridBagLayout());
		final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
				Messages.getString("OptionWizard.57")); //$NON-NLS-1$
		typeOfDbPanel.setBorder(border);

		constraints.gridx = 0;
		constraints.gridy = 1;
		panel.add(typeOfDbPanel, constraints);

		List<String> listOfProjectsByName = new ArrayList<>();
		listOfProjectsByName.addAll(projectsService.getProjectList().keySet());
		Collections.sort(listOfProjectsByName);
		final JList<String> listOfProjects = new JList<>(listOfProjectsByName.toArray(new String[0])); // data has type Object[]
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
		openProject.addActionListener(new ApplyOptionChangesListener(this, localPropertiesService) {

			@Override
			protected void applyProperties() {

				File projectFolder = projectsService.getProjectList().get(listOfProjects.getSelectedValue());

				try {
					projectsService.loadProjectInFolder(projectFolder);
					restartEarth();
				} catch (Exception e1) {
					JOptionPane.showMessageDialog(PropertiesDialog.this, e1.getMessage(),
							Messages.getString("OptionWizard.55"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
					logger.error("Error importing project folder " + projectFolder.getAbsolutePath(), e1); //$NON-NLS-1$
				}

			}

		});

		listOfProjects.addListSelectionListener(e -> openProject.setEnabled(listOfProjects.getSelectedValue() != null) );

		typeOfDbPanel.add(openProject);

		return panel;
	}

	private JScrollPane getOperationModePanelScroll() {
		final JComponent operationModePanel = getOperationModePanel();
		return new JScrollPane(operationModePanel, JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED,JScrollPane.HORIZONTAL_SCROLLBAR_NEVER);
	}

	private JComponent getPlotOptionsPanel() {
		final JPanel panel = new JPanel(new GridBagLayout());
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.fill = GridBagConstraints.HORIZONTAL;

		JLabel label = new JLabel("Plot shape");
		panel.add(label, constraints);

		constraints.gridx = 1;
		JComboBox<SAMPLE_SHAPE> plotShape = (JComboBox<SAMPLE_SHAPE>) propertyToComponent
				.get(EarthProperty.SAMPLE_SHAPE)[0];
		panel.add(plotShape, constraints);

		constraints.gridx = 0;
		constraints.gridy++;
		label = new JLabel(Messages.getString("OptionWizard.35")); //$NON-NLS-1$
		panel.add(label, constraints);

		constraints.gridx = 1;
		JComboBox<ComboBoxItem> numberPoints = (JComboBox<ComboBoxItem>) propertyToComponent
				.get(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT)[0];
		panel.add(numberPoints, constraints);

		constraints.gridx = 0;
		constraints.gridy++;
		JLabel distanceOrRadiuslabel = new JLabel(Messages.getString("OptionWizard.36")); //$NON-NLS-1$
		panel.add(distanceOrRadiuslabel, constraints);

		constraints.gridx = 1;
		JComboBox<String> distanceBetweenPoints = (JComboBox<String>) propertyToComponent
				.get(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)[0];
		panel.add(new JScrollPane(distanceBetweenPoints), constraints);

		constraints.gridx = 0;
		constraints.gridy++;
		label = new JLabel(Messages.getString("OptionWizard.37")); //$NON-NLS-1$
		panel.add(label, constraints);
		constraints.gridx = 1;
		JComboBox<String> distanceToFrame = (JComboBox<String>) propertyToComponent
				.get(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES)[0];
		panel.add(new JScrollPane(distanceToFrame), constraints);

		constraints.gridx = 0;
		constraints.gridy++;
		label = new JLabel(Messages.getString("OptionWizard.95")); //$NON-NLS-1$
		panel.add(label, constraints);
		constraints.gridx = 1;
		JComboBox<String> dotsSide = (JComboBox<String>) propertyToComponent.get(EarthProperty.INNER_SUBPLOT_SIDE)[0];
		panel.add(new JScrollPane(dotsSide), constraints);
		
		constraints.gridx = 0;
		constraints.gridy++;
		label = new JLabel("Central plot side"); //$NON-NLS-1$
		panel.add(label, constraints);
		constraints.gridx = 1;
		JComboBox<String> largeCentralPlotSide = (JComboBox<String>) propertyToComponent.get(EarthProperty.LARGE_CENTRAL_PLOT_SIDE)[0];
		panel.add(new JScrollPane(largeCentralPlotSide), constraints);
		
		

		constraints.gridx = 0;
		constraints.gridy++;
		label = new JLabel("Distance between plots in cluster");
		panel.add(label, constraints);
		constraints.gridx = 1;
		JComboBox<String> plotDistanceInCluster = (JComboBox<String>) propertyToComponent
				.get(EarthProperty.DISTANCE_BETWEEN_PLOTS)[0];
		panel.add(new JScrollPane(plotDistanceInCluster), constraints);

		constraints.gridx = 0;
		constraints.gridy++;
		JLabel area = new JLabel(
				"Area (hectares)  :  " + calculateArea(numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide));
		panel.add(area, constraints);

		ActionListener calculateAreas = actionPerformed -> area.setText("Area (hectares)  :  " + calculateArea(numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide));

		plotShape.addActionListener( e->
				handleVisibilityPlotLayout(plotShape, numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide,
						plotDistanceInCluster, area, distanceOrRadiuslabel, largeCentralPlotSide)
		);

		numberPoints.addActionListener(calculateAreas);
		distanceBetweenPoints.addActionListener(calculateAreas);
		distanceToFrame.addActionListener(calculateAreas);

		handleVisibilityPlotLayout(plotShape, numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide,
				plotDistanceInCluster, area, distanceOrRadiuslabel, largeCentralPlotSide);

		return panel;
	}

	public void handleVisibilityPlotLayout(JComboBox plotShape, JComboBox numberPoints, JComboBox distanceBetweenPoints,
			JComboBox distanceToFrame, JComboBox dotsSide, JComboBox distanceBetweenPlots, JLabel area,
			JLabel distanceOrRadiuslabel, JComboBox largeCentralPlotSide ) {
		numberPoints.setEnabled(false);
		distanceBetweenPoints.setEnabled(false);
		distanceToFrame.setEnabled(false);
		dotsSide.setEnabled(false);
		area.setVisible(false);
		distanceBetweenPlots.setVisible(false);
		distanceBetweenPlots.setEnabled(false);
		largeCentralPlotSide.setVisible( false );
		largeCentralPlotSide.setEnabled(false);

		if (plotShape.getSelectedItem().equals(SAMPLE_SHAPE.SQUARE) || plotShape.getSelectedItem().equals(SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT) ) {
			numberPoints.setEnabled(true);
			distanceBetweenPoints.setEnabled(true);
			distanceToFrame.setEnabled(true);
			dotsSide.setEnabled(true);
			area.setVisible(true);
			distanceOrRadiuslabel.setText(Messages.getString("OptionWizard.36"));
			
			if( plotShape.getSelectedItem().equals(SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT) ) {
				largeCentralPlotSide.setVisible( true );
				largeCentralPlotSide.setEnabled(true);
			}
			
		} else if (plotShape.getSelectedItem().equals(SAMPLE_SHAPE.CIRCLE)
				|| plotShape.getSelectedItem().equals(SAMPLE_SHAPE.HEXAGON)) {
			distanceBetweenPoints.setEnabled(true);
			dotsSide.setEnabled(true);
			numberPoints.setEnabled(true);
			distanceOrRadiuslabel.setText("Radius");
		} else if (plotShape.getSelectedItem().equals(SAMPLE_SHAPE.NFI_THREE_CIRCLES) || plotShape.getSelectedItem().equals(SAMPLE_SHAPE.NFI_FOUR_CIRCLES)) {
			dotsSide.setEnabled(true);
			distanceBetweenPoints.setEnabled(true);
			distanceBetweenPlots.setVisible(true);
			distanceBetweenPlots.setEnabled(true);
			distanceOrRadiuslabel.setText("Radius of the plots");
		}
	}

	private String calculateArea(JComboBox numberOfPoints, JComboBox distanceBetweenPoints, JComboBox distanceToFrame,
			JComboBox dotsSide) {
		double side = 0;
		try {
			int numberOfPointsI = ((ComboBoxItem) numberOfPoints.getSelectedItem()).getNumberOfPoints();
			int distanceBetweenPointsI = Integer.parseInt((String) distanceBetweenPoints.getSelectedItem());
			int distanceToFrameI = Integer.parseInt((String) distanceToFrame.getSelectedItem());

			if (numberOfPointsI == 0 || numberOfPointsI == 1) {

				side = 2d * distanceToFrameI;
				if (oldSelectedDistance == null) {
					oldSelectedDistance = (String) distanceBetweenPoints.getSelectedItem();
					distanceBetweenPoints.setEnabled(false);
				}
				distanceBetweenPoints.setSelectedItem("0");

				if (numberOfPointsI == 0) {
					dotsSide.setEnabled(false);
				} else if (numberOfPointsI == 1) {
					dotsSide.setEnabled(true);
				}

			} else {
				if (oldSelectedDistance != null) {
					distanceBetweenPoints.setSelectedItem(oldSelectedDistance);
					oldSelectedDistance = null;
				}

				distanceBetweenPoints.setEnabled(true);
				distanceToFrame.setEnabled(true);
				dotsSide.setEnabled(true);

				double pointsByLines = Math.sqrt(numberOfPointsI);
				side = 2d * distanceToFrameI + (pointsByLines - 1) * distanceBetweenPointsI;

			}

		} catch (RuntimeException e) {
			logger.error("Error calculating area of the plot", e);
		}

		DecimalFormat df = new DecimalFormat("###.##");
		return df.format(side * side / 10000d);
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

		final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
				Messages.getString("OptionWizard.6")); //$NON-NLS-1$
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

		constraints.gridx = 2;
		panel.add(new JLabel("Default: 5432"), constraints);

		constraints.gridy++;
		constraints.gridx = 1;
		JButton button = new JButton("Test Connection"); //$NON-NLS-1$
		button.addActionListener( e-> {
				String host = ((JTextField) (propertyToComponent.get(EarthProperty.DB_HOST)[0])).getText();
				String port = ((JTextField) (propertyToComponent.get(EarthProperty.DB_PORT)[0])).getText();
				String dbName = ((JTextField) (propertyToComponent.get(EarthProperty.DB_NAME)[0])).getText();
				String username = ((JTextField) (propertyToComponent.get(EarthProperty.DB_USERNAME)[0])).getText();
				String password = ((JTextField) (propertyToComponent.get(EarthProperty.DB_PASSWORD)[0])).getText();

				String message = CollectEarthUtils.testPostgreSQLConnection(host, port, dbName, username, password);
				JOptionPane.showMessageDialog(PropertiesDialog.this.getOwner(), message, "PostgreSQL Connection test",
						JOptionPane.INFORMATION_MESSAGE);
		});
		panel.add(button, constraints);

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

		final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
				Messages.getString("OptionWizard.30")); //$NON-NLS-1$
		panel.setBorder(border);

		panel.add(propertyToComponent.get(EarthProperty.AUTOMATIC_BACKUP)[0], constraints);
		constraints.gridx++;
		panel.add(getOpenBackupFolderButton());
		return panel;
	}

	private JComponent getSampleDataPanel() {
		final JPlotCsvTable samplePlots = new JPlotCsvTable(localPropertiesService.getValue(EarthProperty.SAMPLE_FILE),
				surveyLoaded);

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

		panel.add(new JScrollPane(samplePlots, ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
				ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED), constraints);

		return panel;
	}

	private JFilePicker getFilePickerSamplePlots(final JPlotCsvTable samplePlots) {
		final JFilePicker refreshTableOnFileChange = (JFilePicker) (propertyToComponent
				.get(EarthProperty.SAMPLE_FILE)[0]);
		refreshTableOnFileChange.addChangeListener(new DocumentListener() {

			@Override
			public void changedUpdate(DocumentEvent e) {
				// Do not react
			}

			@Override
			public void insertUpdate(DocumentEvent e) {
				refreshTable();
			}

			@Override
			public void removeUpdate(DocumentEvent e) {
				// Do not react
			}

			private void refreshTable() {
				samplePlots.refreshTable(refreshTableOnFileChange.getSelectedFilePath());

				// Do not let the user save the changes if the sample data is wrong!!!
				getApplyChangesButton().setEnabled(samplePlots.isDataValid());
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
		final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
				Messages.getString("OptionWizard.3")); //$NON-NLS-1$
		typeOfDbPanel.setBorder(border);

		JLabel label = new JLabel(Messages.getString("OptionWizard.4") + CollectEarthUtils.getComputerIp()); //$NON-NLS-1$
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
		sqlitePanel = getSqlLitePanel();

		boolean usingPostgreSQL = localPropertiesService.getCollectDBDriver().equals(CollectDBDriver.POSTGRESQL);
		enableDBOptions(usingPostgreSQL);

		for (final JComponent typeRadioButton : dbTypes) {
			final JRadioButton dbTypeButton = (JRadioButton) typeRadioButton;
			bg.add(dbTypeButton);
			typeOfDbPanel.add(dbTypeButton, constraints);
			constraints.gridy++;

			dbTypeButton.addActionListener(getDbTypeListener());

			if (dbTypeButton.getName().equals(EarthConstants.CollectDBDriver.POSTGRESQL.name())) {
				typeOfDbPanel.add(postgresPanel, constraints);
				constraints.gridy++;

			} else {
				typeOfDbPanel.add(sqlitePanel, constraints);
				constraints.gridy++;
			}
		}
		return typeOfDbPanel;
	}

	private Component getOpenBackupFolderButton() {

		AbstractAction backupAction = new AbstractAction(Messages.getString("OptionWizard.10")) { //$NON-NLS-1$

			private static final long serialVersionUID = 1L;

			@Override
			public void actionPerformed(ActionEvent e) {
				try {

					CollectEarthUtils.openFolderInExplorer(backupFolder);

				} catch (final IOException e1) {
					logger.error("Error when opening the explorer window to visualize backups", e1); //$NON-NLS-1$
				}
			}

		};

		return new JButton(backupAction);

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
		backupCheckbox
				.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.AUTOMATIC_BACKUP)));
		propertyToComponent.put(EarthProperty.AUTOMATIC_BACKUP, new JComponent[] { backupCheckbox });

		final JCheckBox openEarthEngineCheckbox = new JCheckBox(Messages.getString("OptionWizard.45")); //$NON-NLS-1$
		openEarthEngineCheckbox
				.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_EARTH_ENGINE)));
		propertyToComponent.put(EarthProperty.OPEN_EARTH_ENGINE, new JComponent[] { openEarthEngineCheckbox });

		final JCheckBox openTimelapseCheckbox = new JCheckBox(Messages.getString("OptionWizard.46")); //$NON-NLS-1$
		openTimelapseCheckbox
				.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_TIMELAPSE)));
		propertyToComponent.put(EarthProperty.OPEN_TIMELAPSE, new JComponent[] { openTimelapseCheckbox });

		final JCheckBox openBingCheckbox = new JCheckBox(Messages.getString("OptionWizard.47")); //$NON-NLS-1$
		openBingCheckbox
				.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_BING_MAPS)));
		propertyToComponent.put(EarthProperty.OPEN_BING_MAPS, new JComponent[] { openBingCheckbox });
		
		final JCheckBox openBaiduCheckbox = new JCheckBox("Open Baidu Maps");
		openBaiduCheckbox
				.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_BAIDU_MAPS)));
		propertyToComponent.put(EarthProperty.OPEN_BAIDU_MAPS, new JComponent[] { openBaiduCheckbox });


		final JCheckBox openYandexCheckbox = new JCheckBox("Open Yandex maps for the plot area");
		openYandexCheckbox
				.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_YANDEX_MAPS)));
		propertyToComponent.put(EarthProperty.OPEN_YANDEX_MAPS, new JComponent[] { openYandexCheckbox });

		final JCheckBox openStreetViewCheckbox = new JCheckBox("Open Street View");
		openStreetViewCheckbox
				.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_STREET_VIEW)));
		propertyToComponent.put(EarthProperty.OPEN_STREET_VIEW, new JComponent[] { openStreetViewCheckbox });

		final JCheckBox openHereCheckbox = new JCheckBox(Messages.getString("OptionWizard.59")); //$NON-NLS-1$
		openHereCheckbox
				.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_HERE_MAPS)));
		propertyToComponent.put(EarthProperty.OPEN_HERE_MAPS, new JComponent[] { openHereCheckbox });

		final JCheckBox openGeePlaygroundCheckbox = new JCheckBox(Messages.getString("OptionWizard.58")); //$NON-NLS-1$
		openGeePlaygroundCheckbox
				.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_GEE_PLAYGROUND)));
		propertyToComponent.put(EarthProperty.OPEN_GEE_PLAYGROUND, new JComponent[] { openGeePlaygroundCheckbox });

		final JCheckBox openInSeparateWindowCheckbox = new JCheckBox(Messages.getString("OptionWizard.48")); //$NON-NLS-1$
		openInSeparateWindowCheckbox.setSelected(
				Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_BALLOON_IN_BROWSER)));
		propertyToComponent.put(EarthProperty.OPEN_BALLOON_IN_BROWSER,
				new JComponent[] { openInSeparateWindowCheckbox });

		final JFilePicker csvWithPlotData = new JFilePicker(Messages.getString("OptionWizard.49"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.SAMPLE_FILE), Messages.getString("OptionWizard.50"), DlgMode.MODE_OPEN); // $NON-NLS-1$

		csvWithPlotData.addFileTypeFilter(".csv,.ced", Messages.getString("OptionWizard.52"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.SAMPLE_FILE, new JComponent[] { csvWithPlotData });

		final JComboBox<SAMPLE_SHAPE> plotShape = new JComboBox<>(SAMPLE_SHAPE.values());
		try {
			plotShape.setSelectedItem(SAMPLE_SHAPE.valueOf(localPropertiesService.getValue(EarthProperty.SAMPLE_SHAPE)));
		} catch (Exception e1) {
			logger.error("The selected shape type is not supported " + localPropertiesService.getValue(EarthProperty.SAMPLE_SHAPE), e1 );
		}
		propertyToComponent.put(EarthProperty.SAMPLE_SHAPE, new JComponent[] { plotShape });

		final JComboBox<ComboBoxItem> comboNumberOfPoints = new JComboBox<>(
				new ComboBoxItem[] { COMBO_BOX_ITEM_SQUARE, COMBO_BOX_ITEM_CENTRAL_POINT, new ComboBoxItem(4, "2x2"), //$NON-NLS-1$ //$NON-NLS-2$
																														// //$NON-NLS-3$
						new ComboBoxItem(9, "3x3"), new ComboBoxItem(16, "4x4"), new ComboBoxItem(25, "5x5"), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
						new ComboBoxItem(36, "6x6"), //$NON-NLS-1$
						new ComboBoxItem(49, "7x7") }); //$NON-NLS-1$
		comboNumberOfPoints.setSelectedItem(new ComboBoxItem(
				Integer.parseInt(localPropertiesService.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT)),
				"")); //$NON-NLS-1$
		propertyToComponent.put(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT,
				new JComponent[] { comboNumberOfPoints });

		final String[] listOfNumbers = new String[1500];
		final String[] listOfNumbersFromTwo = new String[1500];

		for (int index = 0; index < listOfNumbers.length; index++) {
			listOfNumbers[index] = Integer.toString( index ); //$NON-NLS-1$
			listOfNumbersFromTwo[index] =  Integer.toString( index + 2 ); //$NON-NLS-1$
		}

		final JComboBox<String> listOfDistanceBetweenPoints = new JComboBox<>(listOfNumbersFromTwo);
		listOfDistanceBetweenPoints
				.setSelectedItem(localPropertiesService.getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS));
		listOfDistanceBetweenPoints.setAutoscrolls(true);

		propertyToComponent.put(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS,
				new JComponent[] { listOfDistanceBetweenPoints });

		final JComboBox<String> listOfDistanceBetweenPlots = new JComboBox<>(listOfNumbersFromTwo);
		listOfDistanceBetweenPlots
				.setSelectedItem(localPropertiesService.getValue(EarthProperty.DISTANCE_BETWEEN_PLOTS));
		listOfDistanceBetweenPlots.setAutoscrolls(true);

		propertyToComponent.put(EarthProperty.DISTANCE_BETWEEN_PLOTS, new JComponent[] { listOfDistanceBetweenPlots });

		final JComboBox<String> listOfDistanceToBorder = new JComboBox<>(listOfNumbers);
		listOfDistanceToBorder
				.setSelectedItem(localPropertiesService.getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES));
		listOfDistanceToBorder.setAutoscrolls(true);

		propertyToComponent.put(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, new JComponent[] { listOfDistanceToBorder });

		final JComboBox<String> listOfSizeofSamplingDot = new JComboBox<>(listOfNumbersFromTwo);
		listOfSizeofSamplingDot.setSelectedItem(localPropertiesService.getValue(EarthProperty.INNER_SUBPLOT_SIDE));
		listOfSizeofSamplingDot.setAutoscrolls(true);

		propertyToComponent.put(EarthProperty.INNER_SUBPLOT_SIDE, new JComponent[] { listOfSizeofSamplingDot });
		
		final JComboBox<String> listOfSideOflargeCentralPlot = new JComboBox<>(listOfNumbersFromTwo);
		listOfSideOflargeCentralPlot.setSelectedItem(localPropertiesService.getValue(EarthProperty.LARGE_CENTRAL_PLOT_SIDE));
		listOfSideOflargeCentralPlot.setAutoscrolls(true);

		propertyToComponent.put(EarthProperty.LARGE_CENTRAL_PLOT_SIDE, new JComponent[] { listOfSideOflargeCentralPlot });
		

		final JRadioButton chromeChooser = new JRadioButton("Chrome"); //$NON-NLS-1$
		chromeChooser.setSelected(localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim()
				.equals(EarthConstants.CHROME_BROWSER));
		chromeChooser.setName(EarthConstants.CHROME_BROWSER);

		final JRadioButton firefoxChooser = new JRadioButton("Firefox"); //$NON-NLS-1$
		firefoxChooser.setSelected(localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim()
				.equals(EarthConstants.FIREFOX_BROWSER));
		firefoxChooser.setName(EarthConstants.FIREFOX_BROWSER);
		propertyToComponent.put(EarthProperty.BROWSER_TO_USE, new JComponent[] { firefoxChooser, chromeChooser });

		final JFilePicker saikuPath = new JFilePicker(Messages.getString("OptionWizard.65"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER),
				Messages.getString("OptionWizard.66"), DlgMode.MODE_OPEN); //$NON-NLS-1$
		saikuPath.setFolderChooser();
		saikuPath.addChangeListener(new DocumentListener() {

			private void showSaikuWarning() {
				final File saikuFolder = new File(saikuPath.getSelectedFilePath());
				if ( !saikuService.isSaikuFolder(saikuFolder)) {
					JOptionPane.showMessageDialog(PropertiesDialog.this, Messages.getString("OptionWizard.27"), //$NON-NLS-1$
							Messages.getString("OptionWizard.28"), JOptionPane.INFORMATION_MESSAGE); //$NON-NLS-1$
					saikuPath.getTextField().setBackground(CollectEarthWindow.ERROR_COLOR);
				} else {
					saikuPath.getTextField().setBackground(Color.white);
				}
			}

			@Override
			public void removeUpdate(DocumentEvent e) {
				// Do not react
			}

			@Override
			public void insertUpdate(DocumentEvent e) {
				showSaikuWarning();
			}

			@Override
			public void changedUpdate(DocumentEvent e) {
				// Do not react
			}
		});
		propertyToComponent.put(EarthProperty.SAIKU_SERVER_FOLDER, new JComponent[] { saikuPath });

		final JFilePicker firefoxBinaryPath = new JFilePicker(Messages.getString("OptionWizard.67"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.FIREFOX_BINARY_PATH),
				Messages.getString("OptionWizard.68"), DlgMode.MODE_OPEN); //$NON-NLS-1$
		firefoxBinaryPath.addFileTypeFilter(".exe", Messages.getString("OptionWizard.70"), true); //$NON-NLS-1$ //$NON-NLS-2$
		firefoxBinaryPath.addFileTypeFilter(".bin", Messages.getString("OptionWizard.72"), false); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.FIREFOX_BINARY_PATH, new JComponent[] { firefoxBinaryPath });

		final JFilePicker chromeBinaryPath = new JFilePicker(Messages.getString("OptionWizard.73"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.CHROME_BINARY_PATH),
				Messages.getString("OptionWizard.74"), DlgMode.MODE_OPEN); //$NON-NLS-1$
		chromeBinaryPath.addFileTypeFilter(".exe", Messages.getString("OptionWizard.76"), true); //$NON-NLS-1$ //$NON-NLS-2$
		chromeBinaryPath.addFileTypeFilter(".bin", Messages.getString("OptionWizard.78"), false); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.CHROME_BINARY_PATH, new JComponent[] { chromeBinaryPath });

		final JFilePicker kmlTemplatePath = new JFilePicker(Messages.getString("OptionWizard.79"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.KML_TEMPLATE_KEY), Messages.getString("OptionWizard.80"), //$NON-NLS-1$
				DlgMode.MODE_OPEN);
		kmlTemplatePath.addFileTypeFilter(".fmt", Messages.getString("OptionWizard.82"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.KML_TEMPLATE_KEY, new JComponent[] { kmlTemplatePath });

		final JFilePicker htmlBalloonPath = new JFilePicker(Messages.getString("OptionWizard.83"), //$NON-NLS-1$
				localPropertiesService.getValue(EarthProperty.BALLOON_TEMPLATE_KEY),
				Messages.getString("OptionWizard.84"), DlgMode.MODE_OPEN); //$NON-NLS-1$
		htmlBalloonPath.addFileTypeFilter(".html,.htm", Messages.getString("OptionWizard.86"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.BALLOON_TEMPLATE_KEY, new JComponent[] { htmlBalloonPath });

		final JFilePicker idmPath = new JFilePicker(Messages.getString("OptionWizard.87"), //$NON-NLS-1$
				localPropertiesService.getImdFile(), Messages.getString("OptionWizard.88"), DlgMode.MODE_OPEN); //$NON-NLS-1$
		idmPath.addFileTypeFilter(".xml", Messages.getString("OptionWizard.90"), true); //$NON-NLS-1$ //$NON-NLS-2$
		propertyToComponent.put(EarthProperty.METADATA_FILE, new JComponent[] { idmPath });

		final JTextField surveyNameTextField = new JTextField(
				localPropertiesService.getValue(EarthProperty.SURVEY_NAME));
		surveyNameTextField.setEnabled(false);
		propertyToComponent.put(EarthProperty.SURVEY_NAME, new JComponent[] { surveyNameTextField });

		// Database options

		final JRadioButton instanceTypeServer = new JRadioButton(Messages.getString("OptionWizard.91")); //$NON-NLS-1$
		instanceTypeServer.setSelected(localPropertiesService.getOperationMode().equals(OperationMode.SERVER_MODE));
		instanceTypeServer.setName(EarthConstants.OperationMode.SERVER_MODE.name());

		final JRadioButton instanceTypeClient = new JRadioButton(Messages.getString("OptionWizard.92")); //$NON-NLS-1$
		instanceTypeClient.setSelected(localPropertiesService.getOperationMode().equals(OperationMode.CLIENT_MODE));
		instanceTypeClient.setName(EarthConstants.OperationMode.CLIENT_MODE.name());
		propertyToComponent.put(EarthProperty.OPERATION_MODE,
				new JComponent[] { instanceTypeServer, instanceTypeClient });

		final JTextField collectEarthServerIp = new JTextField(localPropertiesService.getValue(EarthProperty.HOST_KEY));
		propertyToComponent.put(EarthProperty.HOST_KEY, new JComponent[] { collectEarthServerIp });

		final JTextField collectEarthServerIpPort = new JTextField(localPropertiesService.getPort());
		final JTextField collectEarthServerLocalPort = new JTextField(
				localPropertiesService.getValue(EarthProperty.HOST_PORT_KEY));
		propertyToComponent.put(EarthProperty.HOST_PORT_KEY,
				new JComponent[] { collectEarthServerIpPort, collectEarthServerLocalPort });

		final JRadioButton sqliteDbType = new JRadioButton(Messages.getString("OptionWizard.93")); //$NON-NLS-1$
		sqliteDbType.setSelected(localPropertiesService.getCollectDBDriver().equals(CollectDBDriver.SQLITE));
		sqliteDbType.setName(CollectDBDriver.SQLITE.name());

		final JRadioButton postgresDbType = new JRadioButton(Messages.getString("OptionWizard.94")); //$NON-NLS-1$
		boolean usingPostgreSQL = localPropertiesService.getCollectDBDriver().equals(CollectDBDriver.POSTGRESQL);
		postgresDbType.setSelected(usingPostgreSQL);
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

	public boolean isRestartRequired() {
		return restartRequired;
	}

	public void setRestartRequired(boolean restartRequired) {
		this.restartRequired = restartRequired;
	}

}

package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.IOException;
import java.util.HashMap;
import java.util.Set;

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
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;
import javax.swing.border.TitledBorder;
import javax.swing.text.JTextComponent;

import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;

public class OptionWizard extends JDialog{

	/**
	 * 
	 */
	private static final long serialVersionUID = -6760020609229102842L;
	HashMap<EarthProperty, JComponent[] > propertyToComponent = new HashMap<EarthProperty, JComponent[]>(); 
	Logger logger = LoggerFactory.getLogger( this.getClass() );

	@Autowired
	LocalPropertiesService localPropertiesService;

	public OptionWizard(JFrame frame, LocalPropertiesService localPropertiesService) {
		super(frame, "Collect Earth options");
		this.localPropertiesService = localPropertiesService;
		initilizeInputs();
		buildMainPane();
	}
	
	
	private class ComboBoxItem{
		private Integer numberOfPoints;

		private String label;
		
		public ComboBoxItem(int numberOfPoints, String label) {
			super();
			this.numberOfPoints = numberOfPoints;
			this.label = label;
		}

		public int getNumberOfPoints() {
			return numberOfPoints;
		}

		
		@Override
		public String toString() {
			return label;
		}
		
		@Override
		public boolean equals(Object obj) {
			return numberOfPoints.equals( ( (ComboBoxItem)obj).getNumberOfPoints() );
		}
		
	}



	private void buildMainPane(){

		JPanel panel = new JPanel( new BorderLayout() );

		panel.add( getOptionTabs() , BorderLayout.CENTER );

		JPanel buttonPanel = new JPanel();
		buttonPanel.add( getApplyChangesButton()); 
		buttonPanel.add( getCancelButton() ); 

		panel.add( buttonPanel , BorderLayout.PAGE_END  );

		this.add(panel);

	}

	private Component getCancelButton() {
		JButton cancelButton = new JButton("Cancel");
		cancelButton.addActionListener( new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent arg0) {
				OptionWizard.this.dispose();
			}
		});
		return cancelButton;
	}

	private Component getApplyChangesButton() {
		final JButton applyChanges = new JButton("Save & Apply changes");
		applyChanges.addActionListener( new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent arg0) {

				Set<EarthProperty> keySet = propertyToComponent.keySet();
				for (EarthProperty earthProperty : keySet) {
					JComponent component = propertyToComponent.get( earthProperty )[0];
					if( component instanceof JTextComponent ){
						localPropertiesService.setValue(earthProperty, ( (JTextComponent) component ).getText());
					}else if( component instanceof JCheckBox ){
						localPropertiesService.setValue(earthProperty, ( (JCheckBox) component ).isSelected() + "" );
					}else if( component instanceof JComboBox ){
						localPropertiesService.setValue(earthProperty, ( (ComboBoxItem) ( (JComboBox<ComboBoxItem>) component ).getSelectedItem() ).getNumberOfPoints() + "" );
					}else if( component instanceof JList ){
						localPropertiesService.setValue(earthProperty, ( (JList) component ).getSelectedValue() + "" );
					}else if( component instanceof JRadioButton ){
						JComponent[] jComponents = propertyToComponent.get( earthProperty );
						for (JComponent jComponent : jComponents) {
							if( ( (JRadioButton) jComponent).isSelected() ) { 
								localPropertiesService.setValue( earthProperty, ( (JRadioButton) jComponent).getName() );
							}
						}
					}else if(component instanceof JFilePicker){
						localPropertiesService.setValue( earthProperty, ( (JFilePicker) component ).getSelectedFilePath() );
					}
				}

				localPropertiesService.nullifyChecksumValues();


				try {
					EarthApp earthApp = new EarthApp( localPropertiesService );
					// Re-generate KMZ
					earthApp.generateKmzFile();
					// Re-open the KMZ file in Google Earth
					earthApp.simulateClickKmz();

					JOptionPane.showMessageDialog(OptionWizard.this, "<html>The Google Earth contents have been changed.<br/>Please accept the content reload when you are prompted by Google Earth.</html>", "Update succesful", JOptionPane.INFORMATION_MESSAGE);
					OptionWizard.this.dispose();

				} catch (IOException e) {
					logger.error( "Error when re-generating the KML code to open in GE ", e);
					JOptionPane.showMessageDialog( OptionWizard.this, null, "There was an error when re-opening the Google Earth data" , JOptionPane.WARNING_MESSAGE );
				}

			}
		});

		return applyChanges;
	}

	private void initilizeInputs(){

		JCheckBox openEarthEngineCheckbox = new JCheckBox( "Open Earth Engine in separate window");
		openEarthEngineCheckbox.setSelected( Boolean.parseBoolean(localPropertiesService.getValue( EarthProperty.OPEN_EARTH_ENGINE) ) );
		propertyToComponent.put( EarthProperty.OPEN_EARTH_ENGINE, new JComponent[]{openEarthEngineCheckbox });

		JCheckBox openInSeparateWindowCheckbox = new JCheckBox("Open form on a browser instead of Google Earth");
		openInSeparateWindowCheckbox.setSelected( Boolean.parseBoolean(localPropertiesService.getValue( EarthProperty.OPEN_BALLOON_IN_BROWSER) ) );
		propertyToComponent.put( EarthProperty.OPEN_BALLOON_IN_BROWSER, new JComponent[]{openInSeparateWindowCheckbox} );

		JFilePicker csvWithPlotData = new JFilePicker("Path to ced/csv file with plot data",  localPropertiesService.getValue( EarthProperty.CSV_KEY), "Browse...");
		csvWithPlotData.setMode(JFilePicker.MODE_OPEN);	
		csvWithPlotData.addFileTypeFilter(".ced", "CSV file with extra elevation data", true);
		csvWithPlotData.addFileTypeFilter(".csv", "CSV file with only coordinates", false);
		propertyToComponent.put(EarthProperty.CSV_KEY, new JComponent[]{ csvWithPlotData} );

		JComboBox<ComboBoxItem> comboNumberOfPoints = new JComboBox<ComboBoxItem>( 
				new ComboBoxItem[]{
						new ComboBoxItem( 1 , "Central point") ,  
						new ComboBoxItem(4, "2x2"),
						new ComboBoxItem(9, "3x3"),
						new ComboBoxItem(16, "4x4"),
						new ComboBoxItem(25, "5x5"),
						new ComboBoxItem(36, "6x6"),
						new ComboBoxItem(49, "7x7")
				});
		comboNumberOfPoints.setSelectedItem( 
				new ComboBoxItem( Integer.parseInt( 
						localPropertiesService.getValue( EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT) ) ,""
				));
		propertyToComponent.put( EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT, new JComponent[]{comboNumberOfPoints });

		String[] listOfNumbers = new String[995];
		int offset = 5;
		for (int index = 0; index < listOfNumbers.length; index++) {
			listOfNumbers[index] = ( index + offset ) + "";
		}

		//JTextField listOfDistanceBetweenPoints  = new JTextField( localPropertiesService.getValue( EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS) );
		JList<String> listOfDistanceBetweenPoints = new JList<String>( listOfNumbers );
		listOfDistanceBetweenPoints.setSelectedValue( localPropertiesService.getValue( EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS) , false);
		listOfDistanceBetweenPoints.setAutoscrolls( true );
		listOfDistanceBetweenPoints.setVisibleRowCount(1);

		propertyToComponent.put( EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS, new JComponent[]{listOfDistanceBetweenPoints} );

		//		JTextField listOfDistanceToBorder = new JTextField(localPropertiesService.getValue( EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES) );
		JList<String> listOfDistanceToBorder = new JList<String>( listOfNumbers );
		listOfDistanceToBorder.setSelectedValue( localPropertiesService.getValue( EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES) , false);
		listOfDistanceToBorder.setAutoscrolls( true );
		listOfDistanceToBorder.setVisibleRowCount(1);

		propertyToComponent.put( EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, new JComponent[]{listOfDistanceToBorder} );

		JRadioButton chromeChooser = new JRadioButton("Chrome");
		chromeChooser.setSelected( localPropertiesService.getValue( EarthProperty.BROWSER_TO_USE ).trim().equals( LocalPropertiesService.CHROME_BROWSER) );
		chromeChooser.setName(LocalPropertiesService.CHROME_BROWSER);

		JRadioButton firefoxChooser = new JRadioButton("Firefox");
		firefoxChooser.setSelected( localPropertiesService.getValue( EarthProperty.BROWSER_TO_USE ).trim().equals( LocalPropertiesService.FIREFOX_BROWSER) );
		firefoxChooser.setName(LocalPropertiesService.FIREFOX_BROWSER);
		propertyToComponent.put( EarthProperty.BROWSER_TO_USE, new JComponent[]{ firefoxChooser, chromeChooser } );		

		JCheckBox showPlotinGEE = new JCheckBox("Show plot in Google Earth Engine");
		showPlotinGEE.setSelected( localPropertiesService.getValue(EarthProperty.OPEN_EARTH_ENGINE).trim().equals("true"));
		propertyToComponent.put(EarthProperty.OPEN_EARTH_ENGINE, new JComponent[]{showPlotinGEE});

		JFilePicker firefoxBinaryPath = new JFilePicker("Path to Firefox executable ",  localPropertiesService.getValue( EarthProperty.FIREFOX_BINARY_PATH), "Browse...");
		firefoxBinaryPath.setMode(JFilePicker.MODE_OPEN);	
		firefoxBinaryPath.addFileTypeFilter(".exe", "Executable files", true);
		firefoxBinaryPath.addFileTypeFilter(".bin", "Binary files", false);
		propertyToComponent.put(EarthProperty.FIREFOX_BINARY_PATH, new JComponent[]{ firefoxBinaryPath} );

		JFilePicker chromeBinaryPath = new JFilePicker("Path to Chrome executable ",  localPropertiesService.getValue( EarthProperty.CHROME_BINARY_PATH), "Browse...");
		chromeBinaryPath.setMode(JFilePicker.MODE_OPEN);	
		chromeBinaryPath.addFileTypeFilter(".exe", "Executable files", true);
		chromeBinaryPath.addFileTypeFilter(".bin", "Binary files", false);
		propertyToComponent.put(EarthProperty.CHROME_BINARY_PATH, new JComponent[]{ chromeBinaryPath} );
		
		
		JCheckBox openBallonInBrowserCheckbox = new JCheckBox( "Open form in its own browser");
		openBallonInBrowserCheckbox.setSelected( Boolean.parseBoolean(localPropertiesService.getValue( EarthProperty.OPEN_BALLOON_IN_BROWSER) ) );
		propertyToComponent.put( EarthProperty.OPEN_BALLOON_IN_BROWSER, new JComponent[]{openBallonInBrowserCheckbox });
		
		JFilePicker kmlTemplatePath = new JFilePicker("Path to KML Freemarker template ",  localPropertiesService.getValue( EarthProperty.KML_TEMPLATE_KEY), "Browse...");
		kmlTemplatePath.setMode(JFilePicker.MODE_OPEN);	
		kmlTemplatePath.addFileTypeFilter(".fmt", "Freemarker template", true);
		propertyToComponent.put(EarthProperty.KML_TEMPLATE_KEY, new JComponent[]{ kmlTemplatePath} );
		
		JFilePicker htmlBalloonPath = new JFilePicker("Path to HTML Balloon form design ",  localPropertiesService.getValue( EarthProperty.BALLOON_TEMPLATE_KEY), "Browse...");
		htmlBalloonPath.setMode(JFilePicker.MODE_OPEN);	
		htmlBalloonPath.addFileTypeFilter(".html", "HTML webpage", true);
		htmlBalloonPath.addFileTypeFilter(".htm", "HTML webpage", false);
		propertyToComponent.put(EarthProperty.BALLOON_TEMPLATE_KEY, new JComponent[]{ htmlBalloonPath} );
		
		JFilePicker idmPath = new JFilePicker("Path to XML with IDM definition",  localPropertiesService.getValue( EarthProperty.METADATA_FILE), "Browse...");
		idmPath.setMode(JFilePicker.MODE_OPEN);	
		idmPath.addFileTypeFilter(".xml", "XML IDM definition", true);
		propertyToComponent.put(EarthProperty.METADATA_FILE, new JComponent[]{ idmPath} );
		
		JTextField surveyNameTextField = new JTextField( localPropertiesService.getValue( EarthProperty.SURVEY_NAME) );
		propertyToComponent.put( EarthProperty.SURVEY_NAME,new JComponent[]{  surveyNameTextField } );
	}

	private JTabbedPane getOptionTabs(){
		JTabbedPane tabbedPane = new JTabbedPane();
		tabbedPane.setSize(550, 300);
		JComponent panel1 = getSampleDataPanel();
		tabbedPane.addTab("Sample data", panel1);

		JComponent panel2 = getPlotOptionsPanel();
		tabbedPane.addTab("Plot options", panel2 );

		JComponent panel3 = getSurveyDefinitonPanel();
		tabbedPane.addTab("Survey Definition", panel3);

		JComponent panel4 = getAdvancedOptionsPanel();
		tabbedPane.addTab("Advanced option", panel4);
		return tabbedPane;
	}

	private JComponent getAdvancedOptionsPanel() {
		JPanel panel = new JPanel( new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.fill = GridBagConstraints.HORIZONTAL;

		panel.add( propertyToComponent.get(EarthProperty.OPEN_EARTH_ENGINE )[0],constraints );

		JPanel browserChooserPanel = new JPanel();
		Border browserBorder = new TitledBorder(new BevelBorder(BevelBorder.LOWERED), "Choose Browser");
		browserChooserPanel.setBorder(browserBorder);

		ButtonGroup browserChooser = new ButtonGroup();
		JComponent[] browsers = propertyToComponent.get( EarthProperty.BROWSER_TO_USE );
		for (JComponent broserRadioButton : browsers) {
			browserChooserPanel.add( broserRadioButton );
			browserChooser.add((AbstractButton) broserRadioButton );
		}
		constraints.gridy++;
		panel.add(browserChooserPanel, constraints );

		constraints.gridy++;
		constraints.gridx = 0;
		panel.add( propertyToComponent.get(EarthProperty.FIREFOX_BINARY_PATH )[0] , constraints);

		constraints.gridy++;
		constraints.gridx = 0;
		panel.add( propertyToComponent.get(EarthProperty.CHROME_BINARY_PATH )[0], constraints );


		return panel;
	}

	private JComponent getSurveyDefinitonPanel() {
		JPanel panel = new JPanel( new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.fill = GridBagConstraints.HORIZONTAL;

		panel.add( propertyToComponent.get(EarthProperty.OPEN_BALLOON_IN_BROWSER )[0],constraints );

		constraints.gridy++;
		constraints.gridwidth = GridBagConstraints.NONE;
		JLabel label = new JLabel("Name of survey");
		panel.add( label, constraints );
		constraints.gridx =1;
		panel.add( propertyToComponent.get( EarthProperty.SURVEY_NAME)[0], constraints );
		
		constraints.gridy++;
		constraints.gridwidth = GridBagConstraints.REMAINDER;
		constraints.gridx = 0;
		panel.add( propertyToComponent.get(EarthProperty.KML_TEMPLATE_KEY )[0] , constraints);

		constraints.gridy++;
		constraints.gridx = 0;
		panel.add( propertyToComponent.get(EarthProperty.BALLOON_TEMPLATE_KEY )[0], constraints );
		
		constraints.gridy++;
		constraints.gridx = 0;
		panel.add( propertyToComponent.get(EarthProperty.METADATA_FILE )[0], constraints );


		return panel;
	}

	private JComponent getPlotOptionsPanel() {
		JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.fill = GridBagConstraints.HORIZONTAL;
		
		JLabel label = new JLabel("Number of sample points");
		panel.add( label, constraints );

		constraints.gridx =1;
		panel.add( propertyToComponent.get( EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT)[0], constraints );

		constraints.gridx = 0;
		constraints.gridy = 1;
		label = new JLabel("Distance between sampling points ( in meters) ");
		panel.add( label, constraints );

		constraints.gridx = 1;
		panel.add( new JScrollPane( propertyToComponent.get( EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)[0] ), constraints);

		constraints.gridx = 0;
		constraints.gridy = 2;
		label = new JLabel("Distance from external sampling points to border ( in meters) ");
		panel.add( label, constraints );
		constraints.gridx = 1;
		panel.add( new JScrollPane( propertyToComponent.get( EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES)[0] ), constraints );
		return panel;
	}

	private JComponent getSampleDataPanel() {
		JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.fill = GridBagConstraints.HORIZONTAL;

		panel.add( propertyToComponent.get( EarthProperty.CSV_KEY)[0] , constraints);


		return panel;
	}

}

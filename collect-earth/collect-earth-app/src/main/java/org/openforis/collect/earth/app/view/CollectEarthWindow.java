package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.Frame;
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
import java.util.List;

import javax.swing.BorderFactory;
import javax.swing.ButtonGroup;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JMenu;
import javax.swing.JMenuBar;
import javax.swing.JMenuItem;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JRadioButtonMenuItem;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.SwingConstants;
import javax.swing.WindowConstants;
import javax.swing.border.Border;
import javax.swing.filechooser.FileFilter;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.BackupService;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.io.data.DataImportSummaryItem;
import org.openforis.collect.io.data.XMLDataImportProcess;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class CollectEarthWindow {

	private JFrame frame;
	private final LocalPropertiesService localPropertiesService;
	private final DataImportExportService dataExportService;
	private final Logger logger = LoggerFactory.getLogger(CollectEarthWindow.class);
	private final ServerController serverController;
	public static final Color ERROR_COLOR = new Color(225, 124, 124);
	private AnalysisSaikuService analysisSaikuService;
	private String backupFolder;
	private enum DataFormat{ZIP_WITH_XML,CSV,FUSION};
	
	

	public CollectEarthWindow(ServerController serverController) {
		this.serverController = serverController;
		
		this.localPropertiesService = serverController.getContext().getBean(LocalPropertiesService.class);
		this.dataExportService = serverController.getContext().getBean(DataImportExportService.class);
		final BackupService backupService = serverController.getContext().getBean(BackupService.class);
		this.backupFolder = backupService.getBackUpFolder().getAbsolutePath();
		this.analysisSaikuService = serverController.getContext().getBean( AnalysisSaikuService.class );
	}

	private void exportDataTo(ActionEvent e, DataFormat exportType) {
		File[] exportToFile = getFileChooserResults( exportType, true, false);
		if (exportToFile != null && exportToFile.length > 0) {
			
			try {
				switch (exportType) {
					case CSV:
						dataExportService.exportSurveyAsCsv(exportToFile[0]);
						break;
					case ZIP_WITH_XML:
						dataExportService.exportSurveyAsZipWithXml(exportToFile[0]);
						break;
					case FUSION:
						dataExportService.exportSurveyAsFusionTable(exportToFile[0]);
						break;
				}
				
			} catch (Exception e1) {
				JOptionPane.showMessageDialog(this.frame, Messages.getString("CollectEarthWindow.0"), Messages.getString("CollectEarthWindow.1"), //$NON-NLS-1$ //$NON-NLS-2$
						JOptionPane.ERROR_MESSAGE);
				logger.error("Error exporting data to " + exportToFile[0].getAbsolutePath() + " in format " + exportType.name() , e1); //$NON-NLS-1$ //$NON-NLS-2$
			} 
		}
	}
	
	private void importDataFrom(ActionEvent e, DataFormat importType) {
		File[] filesToImport = getFileChooserResults( importType, false, true );
		if (filesToImport != null) {
			
			switch (importType) {
				case ZIP_WITH_XML:
					for (File importedFile : filesToImport) {
						try{
							XMLDataImportProcess dataImportProcess = dataExportService.getImportSummary(importedFile);
							boolean addConflictingRecords = false;
							if( dataImportProcess.getSummary().getConflictingRecords() != null && dataImportProcess.getSummary().getConflictingRecords().size() > 0 ){
								addConflictingRecords = promptAddConflictingRecords(dataImportProcess.getSummary().getConflictingRecords(), importedFile.getName());
							}
							dataExportService.importRecordsFrom(importedFile, dataImportProcess, addConflictingRecords);
						} catch (Exception e1) {
							JOptionPane.showMessageDialog(this.frame,  Messages.getString("CollectEarthWindow.3"), importedFile.getName() + " - " + Messages.getString("CollectEarthWindow.7"), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
									JOptionPane.ERROR_MESSAGE);
							logger.error("Error importing data from " + importedFile.getAbsolutePath() + " in format " + importType.name() , e1); //$NON-NLS-1$ //$NON-NLS-2$
						} 
					}
					
					break;
				default:
					JOptionPane.showMessageDialog(getFrame(), Messages.getString("CollectEarthWindow.33"), //$NON-NLS-1$
							Messages.getString("CollectEarthWindow.34"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
					break;
			}
		}
	}
	
	private boolean promptAddConflictingRecords(List<DataImportSummaryItem> list, String importedFileName) {
		int selectedOption = JOptionPane.showConfirmDialog(null, 
                 
                "<html>" //$NON-NLS-1$
				+ "<b>" + importedFileName + " : </b></br>" //$NON-NLS-1$ //$NON-NLS-2$
                + Messages.getString("CollectEarthWindow.9") //$NON-NLS-1$
                + "<br>" //$NON-NLS-1$
                + Messages.getString("CollectEarthWindow.20") + list.size()  //$NON-NLS-1$
                + "<br>" //$NON-NLS-1$
                + Messages.getString("CollectEarthWindow.25") //$NON-NLS-1$
                + "<br>" //$NON-NLS-1$
                + "<i>" //$NON-NLS-1$
                + Messages.getString("CollectEarthWindow.39") //$NON-NLS-1$
                + "</i>" //$NON-NLS-1$
                + "</html>",  //$NON-NLS-1$
                
                Messages.getString("CollectEarthWindow.43"), //$NON-NLS-1$
                
                JOptionPane.YES_NO_OPTION); 
			return (selectedOption == JOptionPane.YES_OPTION);
	}

	private void exportDataToRDB(ActionEvent e) {
		analysisSaikuService.prepareAnalysis();
	}

	private ActionListener getCloseActionListener() {
		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				frame.dispatchEvent(new WindowEvent(frame, WindowEvent.WINDOW_CLOSING));
			}
		};
	}

	private ActionListener getDisclaimerAction(JFrame owner) {

		final JDialog dialog = new JDialog(owner, Messages.getString("CollectEarthWindow.4")); //$NON-NLS-1$
		dialog.setLocationRelativeTo(owner);
		dialog.setSize(new Dimension(300, 400));
		dialog.setModal(true);

		BorderLayout layoutManager = new BorderLayout();

		JPanel panel = new JPanel(layoutManager);

		dialog.add(panel);

		JTextArea textArea = new JTextArea(getDisclaimerText());
		textArea.setEditable(false);
		textArea.setLineWrap(true);
		textArea.setWrapStyleWord(true);
		JScrollPane scrollPane = new JScrollPane(textArea);
		panel.add(scrollPane, BorderLayout.CENTER);
		scrollPane.setPreferredSize(new Dimension(250, 250));

		JButton close = new JButton(Messages.getString("CollectEarthWindow.5")); //$NON-NLS-1$
		close.addActionListener(new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				dialog.setVisible(false);
			}
		});
		panel.add(close, BorderLayout.SOUTH);

		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				dialog.setVisible(true);
			}
		};
	}

	private String getDisclaimerText() {
		try {
			
			String suffix_lang = localPropertiesService.getUiLanguage().getLocale().getLanguage();
			
			
			return FileUtils.readFileToString(new File("resources/disclaimer_" + suffix_lang + ".txt")); //$NON-NLS-1$
		} catch (IOException e) {
			logger.error("Disclaimer text not found", e); //$NON-NLS-1$
			return Messages.getString("CollectEarthWindow.8"); //$NON-NLS-1$
		}
	}

	private ActionListener getExportActionListener( final DataFormat exportFormat ) {
		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				try{
					startWaiting();
					exportDataTo(e, exportFormat );
				}finally{
					endWaiting();
				}

			}
		};
	}
	
	private ActionListener getImportActionListener( final DataFormat importFormat ) {
		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				try{
					startWaiting();
					importDataFrom(e, importFormat );
				}finally{
					endWaiting();
				}

			}
		};
	}
	
	private ActionListener getSaikuAnalysisActionListener() {
		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				try {
					startWaiting();
					exportDataToRDB(e);
				} catch (Exception e1) {
					logger.error("Error starting Saiku server", e1); //$NON-NLS-1$
				} finally{
					endWaiting();
				}
			}
		};
	}

	private JFrame getFrame() {
		return frame;
	}

	private void endWaiting(){
		getFrame().setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.DEFAULT_CURSOR));
	}
	private void startWaiting(){
		getFrame().setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.WAIT_CURSOR));
	}
	
	public JMenuBar getMenu(JFrame frame) {
		// Where the GUI is created:
		JMenuBar menuBar;
		
		JMenuItem menuItem;

		// Create the menu bar.
		menuBar = new JMenuBar();

		// Build file menu in the menu bar.
		JMenu fileMenu = new JMenu(Messages.getString("CollectEarthWindow.10")); //$NON-NLS-1$

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.11")); //$NON-NLS-1$
		menuItem.addActionListener(getCloseActionListener());
		fileMenu.add(menuItem);
		menuBar.add(fileMenu);

		// Build tools menu in the menu bar.
		JMenu toolsMenu = new JMenu(Messages.getString("CollectEarthWindow.12")); //$NON-NLS-1$

		addImportExportMenu(toolsMenu);
		
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.14")); //$NON-NLS-1$
		menuItem.addActionListener(getSaikuAnalysisActionListener());
		toolsMenu.add(menuItem);
		
		toolsMenu.addSeparator();
		
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.15")); //$NON-NLS-1$
		menuItem.addActionListener(getPropertiesAction(frame));
		toolsMenu.add(menuItem);
		
		JMenu languageMenu = getLanguageMenu();
		toolsMenu.add( languageMenu );
				
		menuBar.add(toolsMenu);
		
		// Build help menu in the menu bar.
		JMenu menuHelp = new JMenu(Messages.getString("CollectEarthWindow.16")); //$NON-NLS-1$

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.17")); //$NON-NLS-1$
		menuItem.addActionListener(getDisclaimerAction(frame));
		menuHelp.add(menuItem);
		menuBar.add(menuHelp);
		


		return menuBar;
	}

	private void addImportExportMenu(JMenu menu) {
		
		JMenu ieSubmenu = new JMenu(Messages.getString("CollectEarthWindow.44")); //$NON-NLS-1$
		JMenuItem menuItem;
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.13")); //$NON-NLS-1$
		menuItem.addActionListener(getExportActionListener(DataFormat.CSV));
		ieSubmenu.add(menuItem);
		
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.45")); //$NON-NLS-1$
		menuItem.addActionListener(getExportActionListener(DataFormat.ZIP_WITH_XML));
		ieSubmenu.add(menuItem);
						
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.6")); //$NON-NLS-1$
		menuItem.addActionListener(getExportActionListener(DataFormat.FUSION));
		ieSubmenu.add(menuItem);
		
		ieSubmenu.addSeparator();
		
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.46")); //$NON-NLS-1$
		menuItem.addActionListener(getImportActionListener(DataFormat.ZIP_WITH_XML));
		ieSubmenu.add(menuItem);
		
		menu.add( ieSubmenu );
	}

	private JMenu getLanguageMenu() {
		
		 ActionListener actionLanguage = new ActionListener() {
		      public void actionPerformed(ActionEvent e) {
		        try {
		        	String langName = ( (JRadioButtonMenuItem)e.getSource() ).getName();
		        	UI_LANGUAGE language = UI_LANGUAGE.valueOf( langName );
					localPropertiesService.setUiLanguage( language);
		        	frame.dispose();
		        	openWindow();
		        } catch (Exception ex) {
		          ex.printStackTrace();
		        }
		      }
		    };
		    
		JMenu menuLanguage = new JMenu(Messages.getString("CollectEarthWindow.2")); //$NON-NLS-1$
		
		ButtonGroup group = new ButtonGroup();
		UI_LANGUAGE[] languages = UI_LANGUAGE.values();
		
		for (UI_LANGUAGE language : languages) {
			JRadioButtonMenuItem langItem = new JRadioButtonMenuItem( language.getLabel() ); //$NON-NLS-1$
			langItem.setName( language.name() );
			langItem.addActionListener(actionLanguage);
			menuLanguage.add(langItem);
			group.add(menuLanguage);
			if( localPropertiesService.getUiLanguage().equals( language ) ){
				langItem.setSelected(true);
			}
			
		}
		
		return menuLanguage;
	}

	private ActionListener getPropertiesAction(final JFrame owner) {
		
		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				final JDialog dialog = new OptionWizard(owner, localPropertiesService, backupFolder);
				dialog.setVisible(true);
				dialog.pack();
			}
		};

	}

	public void openWindow() {

		try {
			localPropertiesService.init();
		} catch (IOException e3) {
			logger.error("Error initializing local properties", e3); //$NON-NLS-1$
		}

		// Initialize the translations
		Messages.setLocale(localPropertiesService.getUiLanguage().getLocale());
		
		// Create and set up the window.
		setFrame(new JFrame(Messages.getString("CollectEarthWindow.19"))); //$NON-NLS-1$
		// frame.setSize(400, 300);
		getFrame().setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
		getFrame().setResizable(false);
		try {
			getFrame().setIconImage(new ImageIcon(new File("images/smallOpenForisBanner.png").toURI().toURL()).getImage()); //$NON-NLS-1$
		} catch (MalformedURLException e2) {
			logger.error(Messages.getString("CollectEarthWindow.21"), e2); //$NON-NLS-1$
		}
		getFrame().addWindowListener(new WindowAdapter() {

			@Override
			public void windowClosing(WindowEvent e) {
				try {

					int confirmation = JOptionPane
							.showConfirmDialog(
									getFrame(),
									Messages.getString("CollectEarthWindow.22"), //$NON-NLS-1$
									Messages.getString("CollectEarthWindow.23"), JOptionPane.YES_NO_OPTION); //$NON-NLS-1$
					if (confirmation == JOptionPane.YES_OPTION) {
						Thread stopServer = new Thread() {
							@Override
							public void run() {
								try {
									serverController.stopServer();
								} catch (Exception e) {
									logger.error("Error when trying to closing the server", e); //$NON-NLS-1$
								}
							};
						};

						getFrame().setVisible(false);
						getFrame().dispose();
						stopServer.start();
						Thread.sleep(2000);

						System.exit(0);
					}
				} catch (Exception e1) {
					logger.error("Error when trying to shutdown the server when window is closed", e1); //$NON-NLS-1$
				}

			}
		});

		JPanel pane = new JPanel(new GridBagLayout());
		Border raisedetched = BorderFactory.createRaisedBevelBorder();
		pane.setBorder(raisedetched);

		GridBagConstraints c = new GridBagConstraints();

		final JTextField operatorTextField = new JTextField(localPropertiesService.getOperator(), 30);

		JLabel operatorTextLabel = new JLabel(Messages.getString("CollectEarthWindow.26"), SwingConstants.CENTER); //$NON-NLS-1$
		operatorTextLabel.setSize(100, 20);

		JButton updateOperator = new JButton(Messages.getString("CollectEarthWindow.27")); //$NON-NLS-1$
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
		c.gridy = 1;
		c.gridwidth = GridBagConstraints.REMAINDER;
		pane.add(new JLabel(Messages.getString("CollectEarthWindow.28") + "<br>" //$NON-NLS-1$ //$NON-NLS-2$
				+ Messages.getString("CollectEarthWindow.30")), c); //$NON-NLS-1$

		c.gridx = 0;
		c.gridy = 2;
		c.gridwidth = GridBagConstraints.REMAINDER;
		JButton exportButton = new JButton(Messages.getString("CollectEarthWindow.31")); //$NON-NLS-1$
		exportButton.addActionListener(getExportActionListener(DataFormat.CSV));
		pane.add(exportButton, c);

		c.gridx = 0;
		c.gridy = 3;
		c.gridwidth = GridBagConstraints.REMAINDER;
		c.fill = GridBagConstraints.NONE;
		JButton closeButton = new JButton(Messages.getString("CollectEarthWindow.32")); //$NON-NLS-1$
		closeButton.addActionListener(getCloseActionListener());
		pane.add(closeButton, c);

		getFrame().getContentPane().add(pane);

		updateOperator.addActionListener(new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				String operatorName = operatorTextField.getText().trim();
				if (operatorName.length() > 5 && operatorName.length() < 50) {
					localPropertiesService.saveOperator(operatorName);
					operatorTextField.setBackground(Color.white);
				} else {
					JOptionPane.showMessageDialog(getFrame(), Messages.getString("CollectEarthWindow.33"), //$NON-NLS-1$
							Messages.getString("CollectEarthWindow.34"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
					operatorTextField.setText(localPropertiesService.getOperator());
				}

			}
		});

		getFrame().setJMenuBar(getMenu(getFrame()));

		// Display the window.
		getFrame().setLocationRelativeTo(null);
		getFrame().pack();
		getFrame().setVisible(true);
		if (operatorTextField.getText().length() > 0) {
			getFrame().setState(Frame.ICONIFIED);
		} else {
			operatorTextField.setBackground(ERROR_COLOR);
			JOptionPane.showMessageDialog(getFrame(),
					Messages.getString("CollectEarthWindow.35"), //$NON-NLS-1$
					Messages.getString("CollectEarthWindow.36"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
		}

	}

	private File[] getFileChooserResults(final DataFormat dataFormat, boolean isSaveDlg, boolean multipleSelect) {
		
		JFileChooser fc ;
		
		
		
		String lastUsedFolder = localPropertiesService.getValue( EarthProperty.LAST_USED_FOLDER );
		if( !StringUtils.isBlank( lastUsedFolder ) ){
			File lastFolder = new File( lastUsedFolder );
			if(lastFolder.exists() ){
				fc= new JFileChooser( lastFolder );
			}else{
				fc= new JFileChooser( );
			}
			
		}else{
			fc = new JFileChooser();
		}
		
		fc.setMultiSelectionEnabled( multipleSelect );
		
		File[] selectedFiles = null;
		fc.addChoosableFileFilter(new FileFilter() {

			@Override
			public boolean accept(File f) {
				if( dataFormat.equals( DataFormat.CSV ) || dataFormat.equals( DataFormat.FUSION )){
					return f.isDirectory() || f.getName().endsWith(".csv"); //$NON-NLS-1$
				}else {
					return f.isDirectory() || f.getName().endsWith(".zip"); //$NON-NLS-1$
				}
			}

			@Override
			public String getDescription() {
				String description = ""; //$NON-NLS-1$
				if( dataFormat.equals( DataFormat.CSV ) ){
					description = Messages.getString("CollectEarthWindow.38"); //$NON-NLS-1$
				}else if( dataFormat.equals( DataFormat.ZIP_WITH_XML ) ){
					description = Messages.getString("CollectEarthWindow.48"); //$NON-NLS-1$
				}else if( dataFormat.equals( DataFormat.FUSION ) ){
					description = Messages.getString("CollectEarthWindow.49"); //$NON-NLS-1$
				}
				return description;
			}
		});

		fc.setAcceptAllFileFilterUsed(true);

		// Handle open button action.

		int returnVal ;
		if( isSaveDlg ){
			returnVal = fc.showSaveDialog(getFrame());
		}else{
			returnVal = fc.showOpenDialog(getFrame());
		}
		
		

		if ( returnVal == JFileChooser.APPROVE_OPTION) {
			
			if( isSaveDlg ){
				selectedFiles = new File[]{ fc.getSelectedFile() };
				String file_name = selectedFiles[0].getAbsolutePath();
				if ( ( dataFormat.equals(DataFormat.CSV) || dataFormat.equals(DataFormat.FUSION ) ) &&!file_name.toLowerCase().endsWith(".csv")) { //$NON-NLS-1$
					file_name += ".csv"; //$NON-NLS-1$
					selectedFiles[0] = new File(file_name);
				}else if ( dataFormat.equals(DataFormat.ZIP_WITH_XML) &&!file_name.toLowerCase().endsWith(".zip")) { //$NON-NLS-1$
					file_name += ".zip"; //$NON-NLS-1$
					selectedFiles[0] = new File(file_name);
				}
			}else{
				selectedFiles = fc.getSelectedFiles();
			}
			
			localPropertiesService.setValue(EarthProperty.LAST_USED_FOLDER, selectedFiles[0].getParent());


		} else {
			logger.info("Save command cancelled by user."); //$NON-NLS-1$
		}
		return selectedFiles;
	}
	
	void setFrame(JFrame frame) {
		this.frame = frame;
	}

}
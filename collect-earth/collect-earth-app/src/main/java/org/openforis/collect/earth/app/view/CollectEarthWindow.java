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
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.MalformedURLException;

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
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.BackupService;
import org.openforis.collect.earth.app.service.DataExportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.manager.dataexport.BackupProcess;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class CollectEarthWindow {

	private JFrame frame;
	private final LocalPropertiesService localPropertiesService;
	private final DataExportService dataExportService;
	private final Logger logger = LoggerFactory.getLogger(CollectEarthWindow.class);
	private final ServerController serverController;
	public static final Color ERROR_COLOR = new Color(225, 124, 124);
	private AnalysisSaikuService analysisSaikuService;
	private String backupFolder;
	
	
	

	public CollectEarthWindow(ServerController serverController) {
		this.serverController = serverController;
		
		this.localPropertiesService = serverController.getContext().getBean(LocalPropertiesService.class);
		this.dataExportService = serverController.getContext().getBean(DataExportService.class);
		final BackupService backupService = serverController.getContext().getBean(BackupService.class);
		this.backupFolder = backupService.getBackUpFolder().getAbsolutePath();
		this.analysisSaikuService = serverController.getContext().getBean( AnalysisSaikuService.class );
	}

	private void exportDataToCsv(ActionEvent e) {
		File selectedFile = selectACsvFile();
		if (selectedFile != null) {
			FileOutputStream fos = null;
			try {
				fos = new FileOutputStream(selectedFile);
				dataExportService.exportSurveyAsCsv(fos);
			} catch (Exception e1) {
				JOptionPane.showMessageDialog(this.frame, Messages.getString("CollectEarthWindow.0"), Messages.getString("CollectEarthWindow.1"), //$NON-NLS-1$ //$NON-NLS-2$
						JOptionPane.ERROR_MESSAGE);
				logger.error("Error exporting data to plain CSV format", e1); //$NON-NLS-1$
			} finally {
				if (fos != null) {
					try {
						fos.close();
					} catch (IOException e1) {
						logger.error("Error closing output stream for fusion table", e); //$NON-NLS-1$
					}
				}
			}
		}
	}
	
	private void exportDataToXml(ActionEvent e) {
		File selectedFile = selectXmlFolder();
		if (selectedFile != null) {
			
			try {
				dataExportService.exportSurveyAsXml(selectedFile);
			} catch (Exception e1) {
				JOptionPane.showMessageDialog(this.frame, "Error while exporting data into XML format", "The data could not be exported",
						JOptionPane.ERROR_MESSAGE);
				logger.error("Error exporting data to plain CSV format", e1); //$NON-NLS-1$
			}		}
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
			return FileUtils.readFileToString(new File("resources/disclaimer.txt")); //$NON-NLS-1$
		} catch (IOException e) {
			logger.error("Disclaimer text not found", e); //$NON-NLS-1$
			return Messages.getString("CollectEarthWindow.8"); //$NON-NLS-1$
		}
	}

	private ActionListener getExportActionListener() {
		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				exportDataToCsv(e);

			}
		};
	}
	
	private ActionListener getExportRDBActionListener() {
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
		JMenu menu;
		JMenuItem menuItem;

		// Create the menu bar.
		menuBar = new JMenuBar();

		// Build second menu in the menu bar.
		menu = new JMenu(Messages.getString("CollectEarthWindow.10")); //$NON-NLS-1$

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.11")); //$NON-NLS-1$
		menuItem.addActionListener(getCloseActionListener());
		menu.add(menuItem);
		menuBar.add(menu);

		// Build second menu in the menu bar.
		menu = new JMenu(Messages.getString("CollectEarthWindow.12")); //$NON-NLS-1$

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.13")); //$NON-NLS-1$
		menuItem.addActionListener(getExportActionListener());
		menu.add(menuItem);
		menuBar.add(menu);
		
		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.14")); //$NON-NLS-1$
		menuItem.addActionListener(getExportRDBActionListener());
		menu.add(menuItem);
		menuBar.add(menu);

		// menuItem = new JMenuItem("Export data to Fusion format CSV");
		// menuItem.addActionListener(getExportFusionActionListener());
		// menu.add(menuItem);
		// menuBar.add(menu);

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.15")); //$NON-NLS-1$
		menuItem.addActionListener(getPropertiesAction(frame));
		menu.add(menuItem);
		menuBar.add(menu);

		JMenu languageMenu = getLanguageMenu();
		menu.add( languageMenu );
		
		
		JMenu menuHelp = new JMenu(Messages.getString("CollectEarthWindow.16")); //$NON-NLS-1$

		menuItem = new JMenuItem(Messages.getString("CollectEarthWindow.17")); //$NON-NLS-1$
		menuItem.addActionListener(getDisclaimerAction(frame));
		menuHelp.add(menuItem);
		menuBar.add(menuHelp);

		return menuBar;
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
		JRadioButtonMenuItem selected = null;
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

	private ActionListener getPropertiesAction(JFrame owner) {
		final JDialog dialog = new OptionWizard(owner, localPropertiesService, backupFolder);
		dialog.setLocationRelativeTo(owner);
		dialog.setSize(new Dimension(600, 720));
		dialog.setModal(true);
		dialog.setResizable(false);

		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
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
		exportButton.addActionListener(getExportActionListener());
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

	private File selectACsvFile() {
		JFileChooser fc = new JFileChooser();
		File selectedFile = null;
		fc.addChoosableFileFilter(new FileFilter() {

			@Override
			public boolean accept(File f) {
				return f.isDirectory() || f.getName().endsWith(".csv"); //$NON-NLS-1$
			}

			@Override
			public String getDescription() {
				return Messages.getString("CollectEarthWindow.38"); //$NON-NLS-1$
			}
		});

		fc.setAcceptAllFileFilterUsed(false);

		// Handle open button action.

		int returnVal = fc.showSaveDialog(getFrame());

		if (returnVal == JFileChooser.APPROVE_OPTION) {
			selectedFile = fc.getSelectedFile();

			String file_name = selectedFile.getAbsolutePath();
			if (!file_name.endsWith(".csv")) { //$NON-NLS-1$
				file_name += ".csv"; //$NON-NLS-1$
				selectedFile = new File(file_name);
			}

			// This is where a real application would open the file.
			logger.info(Messages.getString("CollectEarthWindow.41") + selectedFile.getName() + "."); //$NON-NLS-1$ //$NON-NLS-2$

		} else {
			logger.info("Open command cancelled by user."); //$NON-NLS-1$
		}
		return selectedFile;
	}
	
	private File selectXmlFolder() {
		JFileChooser fc = new JFileChooser();
		File selectedFile = null;
		
		fc.setAcceptAllFileFilterUsed(false);
		fc.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
		// Handle open button action.

		int returnVal = fc.showSaveDialog(getFrame());

		if (returnVal == JFileChooser.APPROVE_OPTION) {
			selectedFile = fc.getSelectedFile();

			// This is where a real application would open the file.
			logger.info("Selected folder " + selectedFile.getName() + "."); //$NON-NLS-1$ //$NON-NLS-2$

		} else {
			logger.info("Open command cancelled by user."); //$NON-NLS-1$
		}
		return selectedFile;
	}

	void setFrame(JFrame frame) {
		this.frame = frame;
	}

}
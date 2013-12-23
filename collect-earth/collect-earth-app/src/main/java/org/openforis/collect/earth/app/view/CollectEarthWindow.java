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
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.SwingConstants;
import javax.swing.WindowConstants;
import javax.swing.border.Border;
import javax.swing.filechooser.FileFilter;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.BackupService;
import org.openforis.collect.earth.app.service.DataExportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
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
	private final AnalysisSaikuService analysisSaikuService;
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
				JOptionPane.showMessageDialog(this.frame, "Error when attempting to export data to CSV file", "Export error",
						JOptionPane.ERROR_MESSAGE);
				logger.error("Error exporting data to plain CSV format", e1);
			} finally {
				if (fos != null) {
					try {
						fos.close();
					} catch (IOException e1) {
						logger.error("Error closing output stream for fusion table", e);
					}
				}
			}
		}
	}

	private void exportDataToFusionCsv(ActionEvent e) {
		File selectedFile = selectACsvFile();
		if (selectedFile != null) {
			FileOutputStream fos = null;
			try {
				fos = new FileOutputStream(selectedFile);
				dataExportService.exportSurveyAsFusionTable(fos);
			} catch (Exception e1) {
				JOptionPane.showMessageDialog(this.frame, "Error when attempting to export data to CSV file", "Export error",
						JOptionPane.ERROR_MESSAGE);
				logger.error("Error exporting data to plain CSV format", e1);
			} finally {
				if (fos != null) {
					try {
						fos.close();
					} catch (IOException e1) {
						logger.error("Error closing output stream for fusion table", e);
					}
				}
			}
		}
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

		final JDialog dialog = new JDialog(owner, "FAO Disclaimer notices");
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

		JButton close = new JButton("Close");
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
			return FileUtils.readFileToString(new File("resources/disclaimer.txt"));
		} catch (IOException e) {
			logger.error("Disclaimer text not found", e);
			return "Disclaimer text could not be found";
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
				exportDataToRDB(e);
			}
		};
	}

	private ActionListener getExportFusionActionListener() {
		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				exportDataToFusionCsv(e);

			}

		};
	}

	JFrame getFrame() {
		return frame;
	}

	public JMenuBar getMenu(JFrame frame) {
		// Where the GUI is created:
		JMenuBar menuBar;
		JMenu menu;
		JMenuItem menuItem;

		// Create the menu bar.
		menuBar = new JMenuBar();

		// Build second menu in the menu bar.
		menu = new JMenu("File");

		menuItem = new JMenuItem("Exit");
		menuItem.addActionListener(getCloseActionListener());
		menu.add(menuItem);
		menuBar.add(menu);

		// Build second menu in the menu bar.
		menu = new JMenu("Tools");

		menuItem = new JMenuItem("Export data to CSV");
		menuItem.addActionListener(getExportActionListener());
		menu.add(menuItem);
		menuBar.add(menu);
		
/*		menuItem = new JMenuItem("Export to RDB");
		menuItem.addActionListener(getExportRDBActionListener());
		menu.add(menuItem);
		menuBar.add(menu);*/

		// menuItem = new JMenuItem("Export data to Fusion format CSV");
		// menuItem.addActionListener(getExportFusionActionListener());
		// menu.add(menuItem);
		// menuBar.add(menu);

		menuItem = new JMenuItem("Properties");
		menuItem.addActionListener(getPropertiesAction(frame));
		menu.add(menuItem);
		menuBar.add(menu);

		menu = new JMenu("Help");

		menuItem = new JMenuItem("Disclaimer");
		menuItem.addActionListener(getDisclaimerAction(frame));
		menu.add(menuItem);
		menuBar.add(menu);

		return menuBar;
	}

	private ActionListener getPropertiesAction(JFrame owner) {
		final JDialog dialog = new OptionWizard(owner, localPropertiesService, backupFolder);
		dialog.setLocationRelativeTo(owner);
		dialog.setSize(new Dimension(600, 400));
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
			logger.error("Error initializing local properties", e3);
		}

		// Create and set up the window.
		setFrame(new JFrame("Collect Earth"));
		// frame.setSize(400, 300);
		getFrame().setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
		getFrame().setResizable(false);
		try {
			getFrame().setIconImage(new ImageIcon(new File("images/smallOpenForisBanner.png").toURI().toURL()).getImage());
		} catch (MalformedURLException e2) {
			logger.error("Could not find icon for main frame", e2);
		}
		getFrame().addWindowListener(new WindowAdapter() {

			@Override
			public void windowClosing(WindowEvent e) {
				try {

					int confirmation = JOptionPane
							.showConfirmDialog(
									getFrame(),
									"<html>Are you sure that you want to close Collect Earth?<br>Closing the window will also close the Collect Earth server</html>",
									"Confirmation needed", JOptionPane.YES_NO_OPTION);
					if (confirmation == JOptionPane.YES_OPTION) {
						Thread stopServer = new Thread() {
							@Override
							public void run() {
								try {
									serverController.stopServer();
								} catch (Exception e) {
									logger.error("Error when trying to closing the server", e);
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
					logger.error("Error when trying to shutdown the server when window is closed", e1);
				}

			}
		});

		JPanel pane = new JPanel(new GridBagLayout());
		Border raisedetched = BorderFactory.createRaisedBevelBorder();
		pane.setBorder(raisedetched);

		GridBagConstraints c = new GridBagConstraints();

		final JTextField operatorTextField = new JTextField(localPropertiesService.getOperator(), 30);

		JLabel operatorTextLabel = new JLabel("Operator", SwingConstants.CENTER);
		operatorTextLabel.setSize(100, 20);

		JButton updateOperator = new JButton("Update");
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
		pane.add(new JLabel("<html><b>Open Foris Collect Earth server should be running while the operator interprets data.</b>" + "<br>"
				+ "Please maintain this window open while you are using Google Earth.</hmtl>"), c);

		c.gridx = 0;
		c.gridy = 2;
		c.gridwidth = GridBagConstraints.REMAINDER;
		JButton exportButton = new JButton("Export collected data to CSV file");
		exportButton.addActionListener(getExportActionListener());
		pane.add(exportButton, c);

		c.gridx = 0;
		c.gridy = 3;
		c.gridwidth = GridBagConstraints.REMAINDER;
		c.fill = GridBagConstraints.NONE;
		JButton closeButton = new JButton("Close");
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
					JOptionPane.showMessageDialog(getFrame(), "The operator name has to be longer than 5 characters and shorter than 50",
							"Validation error", JOptionPane.ERROR_MESSAGE);
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
					"<html>OPERATOR NAME EMPTY!<br>Please fill the operator name and press the \"Update\" button.</hml>",
					"Operator name cannot be empty", JOptionPane.ERROR_MESSAGE);
		}

	}

	private File selectACsvFile() {
		JFileChooser fc = new JFileChooser();
		File selectedFile = null;
		fc.addChoosableFileFilter(new FileFilter() {

			@Override
			public boolean accept(File f) {
				return f.isDirectory() || f.getName().endsWith(".csv");
			}

			@Override
			public String getDescription() {
				return "CSV files";
			}
		});

		fc.setAcceptAllFileFilterUsed(false);

		// Handle open button action.

		int returnVal = fc.showSaveDialog(getFrame());

		if (returnVal == JFileChooser.APPROVE_OPTION) {
			selectedFile = fc.getSelectedFile();

			String file_name = selectedFile.getAbsolutePath();
			if (!file_name.endsWith(".csv")) {
				file_name += ".csv";
				selectedFile = new File(file_name);
			}

			// This is where a real application would open the file.
			logger.info("Saving CSV to file: " + selectedFile.getName() + ".");

		} else {
			logger.info("Open command cancelled by user.");
		}
		return selectedFile;
	}

	void setFrame(JFrame frame) {
		this.frame = frame;
	}

}
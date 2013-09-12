package org.openforis.collect.earth.app.view;

import java.awt.Color;
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
import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.SwingConstants;
import javax.swing.WindowConstants;
import javax.swing.border.Border;
import javax.swing.filechooser.FileFilter;

import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.DataExportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class CollectEarthWindow {

	private JFrame frame;
	private final LocalPropertiesService localPropertiesService;
	private final DataExportService dataExportService;
	private final Logger logger = LoggerFactory.getLogger(CollectEarthWindow.class);
	private final ServerController serverController;

	public CollectEarthWindow(LocalPropertiesService localPropertiesService, DataExportService dataExportService,
			ServerController serverController) {
		super();
		this.localPropertiesService = localPropertiesService;
		this.dataExportService = dataExportService;
		this.serverController = serverController;
	}

	public void createWindow() {

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
						serverController.stopServer();
						getFrame().setVisible(false);
						getFrame().dispose();
					}
				} catch (Exception e1) {
					logger.error("Error when trying to shutdown the server when window is closed", e);
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
		pane.add(new JLabel("<html><b>Open Foris Collect Earth server should be running while the operator interprets data.</b>"
				+ "<br>" + "Please maintain this window open while you are using Google Earth.</hmtl>"), c);

		c.gridx = 0;
		c.gridy = 2;
		c.gridwidth = GridBagConstraints.REMAINDER;
		JButton exportButton = new JButton("Export collected data to CSV file");
		exportButton.addActionListener(getExportActionListener());
		pane.add(exportButton , c);

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
					JOptionPane.showMessageDialog(getFrame(),
							"The operator name has to be longer than 5 characters and shorter than 50", "Validation error",
							JOptionPane.ERROR_MESSAGE);
					operatorTextField.setText(localPropertiesService.getOperator());
				}

			}
		});

		// Display the window.
		getFrame().setLocationRelativeTo(null);
		getFrame().pack();
		getFrame().setVisible(true);
		if (operatorTextField.getText().length() > 0) {
			getFrame().setState(Frame.ICONIFIED);
		} else {
			operatorTextField.setBackground(new Color(225, 124, 124));
			JOptionPane.showMessageDialog(getFrame(),
					"<html>OPERATOR NAME EMPTY!<br>Please fill the operator name and press the \"Update\" button.</hml>",
					"Operator name cannot be empty", JOptionPane.ERROR_MESSAGE);
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

	private ActionListener getCloseActionListener() {
		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				frame.dispatchEvent(new WindowEvent(frame, WindowEvent.WINDOW_CLOSING));
			}
		};
	}

	public void exportDataToCsv(ActionEvent e) {
		JFileChooser fc = new JFileChooser();

		fc.addChoosableFileFilter(new FileFilter() {

			@Override
			public String getDescription() {
				return "CSV files";
			}

			@Override
			public boolean accept(File f) {
				return f.getName().endsWith(".csv");
			}
		});

		fc.setAcceptAllFileFilterUsed(false);

		// Handle open button action.

		int returnVal = fc.showSaveDialog(getFrame());

		if (returnVal == JFileChooser.APPROVE_OPTION) {
			try {
				File file = fc.getSelectedFile();

				String file_name = file.getAbsolutePath();
				if (!file_name.endsWith(".csv")) {
					file_name += ".csv";
					file = new File(file_name);
				}

				// This is where a real application would open the file.
				logger.info("Saving CSV to file: " + file.getName() + ".");
				
				FileOutputStream fos = new FileOutputStream(file);
				dataExportService.exportSurveyAsCsv(fos);

			} catch (Exception e1) {
				logger.error("Error exporting the survey as a CSV.", e1);
			}
		} else {
			logger.info("Open command cancelled by user.");
		}

	}

	JFrame getFrame() {
		return frame;
	}

	void setFrame(JFrame frame) {
		this.frame = frame;
	}

}
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
import java.net.MalformedURLException;

import javax.swing.BorderFactory;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.SwingConstants;
import javax.swing.WindowConstants;
import javax.swing.border.Border;

import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class MainEyeFrame {

	private final LocalPropertiesService localPropertiesService;

	public MainEyeFrame(LocalPropertiesService localPropertiesService) {
		super();
		this.localPropertiesService = localPropertiesService;
	}

	private final Logger logger = LoggerFactory.getLogger(MainEyeFrame.class);

	public void createWindow() {

		localPropertiesService.init();

		// Create and set up the window.
		final JFrame frame = new JFrame("Openforis EYE");
		// frame.setSize(400, 300);
		frame.setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
		frame.setResizable(false);
		try {
			frame.setIconImage(new ImageIcon(new File("images/smallOpenForisBanner.png").toURI().toURL()).getImage());
		} catch (MalformedURLException e2) {
			logger.error("Could not find icon for main frame", e2);
		}
		frame.addWindowListener(new WindowAdapter() {

			@Override
			public void windowClosing(WindowEvent e) {
				try {

					int confirmation = JOptionPane
							.showConfirmDialog(
									frame,
									"<html>Are you sure that you want to close Eye?<br>Closing the window will also close the Eye server</html>",
									"Confirmation needed", JOptionPane.YES_NO_OPTION);
					if (confirmation == JOptionPane.YES_OPTION) {
						EarthApp.getServerInitilizer().stopServer();
						frame.setVisible(false);
						frame.dispose();
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
		pane.add(new JLabel(
				"This is the OpenForis Eye server. Please maintain this window open while you are using Google Earth!"), c);

		frame.getContentPane().add(pane);

		updateOperator.addActionListener(new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				String operatorName = operatorTextField.getText().trim();
				if (operatorName.length() > 5 && operatorName.length() < 50) {
					localPropertiesService.saveOperator(operatorName);
					operatorTextField.setBackground( Color.white );
				} else {
					JOptionPane.showMessageDialog(frame,
							"The operator name has to be longer than 5 characters and shorter than 50", "Validation error",
							JOptionPane.ERROR_MESSAGE);
					operatorTextField.setText(localPropertiesService.getOperator());
				}

			}
		});

		// Display the window.
		frame.setLocationRelativeTo(null);
		frame.pack();
		frame.setVisible(true);
		if (operatorTextField.getText().length() > 0) {
			frame.setState(Frame.ICONIFIED);
		} else {
			operatorTextField.setBackground(new Color(225, 124, 124));
			JOptionPane.showMessageDialog(frame,
					"<html>OPERATOR NAME EMPTY!<br>Please fill the operator name and press the \"Update\" button.</hml>",
					"Operator name cannot be empty", JOptionPane.ERROR_MESSAGE);
		}
	}

}
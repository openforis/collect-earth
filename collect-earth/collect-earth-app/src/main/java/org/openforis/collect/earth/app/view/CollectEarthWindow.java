package org.openforis.collect.earth.app.view;

import java.awt.Color;
import java.awt.FlowLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.GridLayout;
import java.awt.Insets;
import java.awt.Window;
import java.awt.event.ActionListener;
import java.awt.event.KeyAdapter;
import java.awt.event.KeyEvent;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;

import javax.swing.BorderFactory;
import javax.swing.ButtonGroup;
import javax.swing.ImageIcon;
import javax.swing.DefaultListCellRenderer;
import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JMenuItem;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.JToggleButton;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.WindowConstants;
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;

import org.apache.commons.lang3.StringUtils;
import org.kordamp.ikonli.materialdesign.MaterialDesign;
import org.kordamp.ikonli.swing.FontIcon;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.QuitService;
import org.openforis.collect.earth.app.service.WindowLayoutService;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient;
import org.openforis.collect.earth.app.view.ExportActionListener.RecordsToExport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
@Lazy(false)
public class CollectEarthWindow implements InitializingBean, DisposableBean{

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private CollectEarthTransferHandler collectEarthTransferHandler;

	@Autowired
	private CollectEarthMenu collectEarthMenu;

	@Autowired
	private CloudApiClient cloudApiClient;

	@Autowired
	private WindowLayoutService windowLayoutService;

	@Autowired
	private QuitService quitService;

	public static void endWaiting(Window frame) {
		frame.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.DEFAULT_CURSOR));
	}

	public static void startWaiting(Window frame) {
		frame.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.WAIT_CURSOR));
	}

	private JFrame frame;
	private final Logger logger = LoggerFactory.getLogger(CollectEarthWindow.class);
	private JTextField operatorTextField;

	public static final Color ERROR_COLOR = new Color(225, 124, 124);
	private static final Color SELECTED_VIEWER_COLOR = new Color(33, 132, 190);

	private boolean windowClosingListenerAdded;
	private ButtonGroup viewerButtons;
	private JToggleButton classicViewerButton;
	private JToggleButton newViewerButton;
	/** The layout of the browser windows and the buttons to put them back, shown while Google Earth Web is the viewer. */
	private JPanel browserWindowsPanel;
	private JComboBox<String> windowLayoutCombo;
	private transient Timer timerOperatorChanged;

	public CollectEarthWindow() throws IOException {
		// Create and set up the window.
		JFrame framePriv = new JFrame(Messages.getString("CollectEarthWindow.19"));//$NON-NLS-1$

		setFrame(framePriv);
	}

	private void init() {
		Messages.setLocale(localPropertiesService.getUiLanguage().getLocale());
		javax.swing.SwingUtilities.invokeLater( () -> {
			try {
				CollectEarthWindow.this.openWindow();
			} catch (final Exception e) {
				logger.error("Cannot start Earth App", e); //$NON-NLS-1$
				System.exit(0);
			}
		});
	}
	@Override
	public void afterPropertiesSet() throws Exception {
		init();
	}

	@Override
	public void destroy() throws Exception {
		SwingUtilities.invokeAndWait( () -> CollectEarthWindow.this.getFrame().dispose()  );
	}

	private void addWindowClosingListener() {
		// Added once : openWindow() runs again on every change of language, and each run used to add another listener, so the
		// user was asked to confirm the exit once per language they had chosen
		if (windowClosingListenerAdded) {
			return;
		}
		windowClosingListenerAdded = true;

		getFrame().addWindowListener(new WindowAdapter() {

			@Override
			public void windowActivated(WindowEvent e) {
				// back from the options dialog, where the plot viewer can be changed too
				showViewerType();
			}

			@Override
			public void windowClosing(WindowEvent e) {
				try {
					final String keepOpen = Messages.getString("CollectEarthWindow.37"); //$NON-NLS-1$
					final String close = Messages.getString("CollectEarthWindow.42"); //$NON-NLS-1$
					final String[] options = new String[] { close, keepOpen };

					final int confirmation = JOptionPane.showOptionDialog(getFrame(),
							Messages.getString("CollectEarthWindow.22"), //$NON-NLS-1$
							Messages.getString("CollectEarthWindow.23"), //$NON-NLS-1$
							JOptionPane.YES_NO_OPTION, JOptionPane.QUESTION_MESSAGE, null, options, keepOpen);

					if (confirmation == JOptionPane.YES_OPTION) {
						getFrame().setVisible(false);
						getFrame().dispose();
						// The same quit as the pages': the server stopped off the event thread, for at most five seconds, then
						// the process exits whether it has stopped or not
						quitService.run();
					}
				} catch (final Exception e1) {
					logger.error("Error when trying to shutdown the server when window is closed", e1); //$NON-NLS-1$
				}

			}
		});
	}

	private void disableMenuItems() {
		if (localPropertiesService.getOperationMode().equals(OperationMode.CLIENT_MODE)) {
			for (final JMenuItem menuItem : collectEarthMenu.getServerMenuItems()) {
				menuItem.setEnabled(false);
			}
		}
	}

	private void displayWindow() {
		getFrame().setLocationRelativeTo(null);
		getFrame().pack();
		getFrame().setVisible(true);
	}

	protected ActionListener getCloseActionListener() {
		return  e -> getFrame().dispatchEvent(new WindowEvent(getFrame(), WindowEvent.WINDOW_CLOSING));
	}

	public JFrame getFrame() {
		return frame;
	}

	private String getOperator() {
		return localPropertiesService.getOperator();
	}

	private void initializeMenu() {

		collectEarthMenu.removeAll();
		collectEarthMenu.init();
		getFrame().setJMenuBar( collectEarthMenu );

		disableMenuItems();
	}

	private void updateOperatorName() {
		if (localPropertiesService.isCloudSyncEnabled()) {
			return; // the operator is fixed by the cloud login in cloud mode
		}
		final String operatorName = operatorTextField.getText().trim();
		if( !operatorName.equals(localPropertiesService.getOperator() ) ) {
			if (operatorName.length() > 5 && operatorName.length() < 50 ) {
				localPropertiesService.saveOperator(operatorName);
				operatorTextField.setBackground(Color.white);
				JOptionPane.showMessageDialog(getFrame(), Messages.getString("CollectEarthWindow.65"), //$NON-NLS-1$
						Messages.getString("CollectEarthWindow.66"), JOptionPane.INFORMATION_MESSAGE); //$NON-NLS-1$
			} else{
				JOptionPane.showMessageDialog(getFrame(), Messages.getString("CollectEarthWindow.33"), //$NON-NLS-1$
						Messages.getString("CollectEarthWindow.34"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
				operatorTextField.setText(getOperator());
			}
		}
	}

	private void initializePanel() {
		final JPanel pane = new JPanel(new GridBagLayout());

		final Border raisedetched = BorderFactory.createRaisedBevelBorder();
		pane.setBorder(raisedetched);

		// Handle Drag and Drop of files into the panel
		pane.setTransferHandler(collectEarthTransferHandler);

		final GridBagConstraints c = new GridBagConstraints();

		final boolean cloudMode = localPropertiesService.isCloudSyncEnabled();
		operatorTextField = new JTextField(getOperator(), 30);
		if (cloudMode) {
			// In cloud mode the operator identity comes from the cloud login, not free
			// text: show it read-only and greyed. A blank value means "not logged in".
			operatorTextField.setEditable(false);
			operatorTextField.setBackground(new Color(230, 230, 230));
		} else if (StringUtils.isBlank(getOperator())) {
			operatorTextField.setBackground(ERROR_COLOR);
		}

		final JLabel operatorTextLabel = new JLabel(Messages.getString("CollectEarthWindow.26"), SwingConstants.CENTER); //$NON-NLS-1$
		operatorTextLabel.setSize(100, 20);

		c.insets = new Insets(3, 3, 3, 3);
		c.fill = GridBagConstraints.HORIZONTAL;
		c.gridx = 0;
		c.gridy = 0;
		pane.add(operatorTextLabel, c);

		c.weightx = 0;
		c.gridx = 1;
		c.gridy = 0;
		pane.add(operatorTextField, c);

		c.gridx = 0;
		c.gridy++;
		// gridwidth counts columns : HORIZONTAL is a value of the fill constant and happens to be 2, which is what this
		// label needs, but it says something else
		c.gridwidth = 2;
		// Wrapped in html, otherwise the <br> between the two lines is shown as it is written
		pane.add(new JLabel("<html>" + Messages.getString("CollectEarthWindow.28") + "<br>" //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
				+ Messages.getString("CollectEarthWindow.30") + "</html>"), c); //$NON-NLS-1$ //$NON-NLS-2$

		c.gridx = 0;
		c.gridy++;
		c.gridwidth = 2;
		c.fill = GridBagConstraints.HORIZONTAL;

		pane.add(createViewerChoicePanel(), c);

		c.gridx = 0;
		c.gridy++;
		pane.add(createBrowserWindowsPanel(), c);
		showViewerType();

		c.gridx = 0;
		c.gridy++;

		JPanel panelButton = new JPanel();
		final JButton propertiesButton = new JButton(Messages.getString("CollectEarthWindow.15")); //$NON-NLS-1$
		propertiesButton.addActionListener( collectEarthMenu.getPropertiesAction( frame ) );
		propertiesButton.setIcon( FontIcon.of( MaterialDesign.MDI_SETTINGS ));
		panelButton.add(propertiesButton);
		
		final JButton exportButton = new JButton(Messages.getString("CollectEarthWindow.74")); //$NON-NLS-1$
		exportButton.addActionListener( collectEarthMenu.getExportActionListener(DataFormat.ZIP_WITH_XML, RecordsToExport.ALL) );
		exportButton.setIcon( FontIcon.of( MaterialDesign.MDI_FILE_XML ));
		panelButton.add(exportButton);
		
		panelButton.setBorder( new BevelBorder(BevelBorder.RAISED) );
		pane.add(panelButton, c );

		getFrame().getContentPane().add(pane);

		// In cloud mode the operator is fixed by the login, so the free-text debounce
		// and length validation are not wired up.
		if (!cloudMode) {
			// Three seconds after the last key is typed on hte text field the operator name changes on the properties service
			if (timerOperatorChanged != null) {
				// The panel is rebuilt on every change of language : stop the timer of the previous one
				timerOperatorChanged.stop();
			}
			timerOperatorChanged = new Timer(3000, e-> updateOperatorName() );
			// Once : a repeating timer stacked another modal dialog every three seconds while the name was invalid
			timerOperatorChanged.setRepeats(false);

			final Timer operatorTimer = timerOperatorChanged;
			operatorTextField.addKeyListener( new KeyAdapter() {
				@Override
				public void keyTyped(KeyEvent e) {
					operatorTimer.restart();
				}
			});
		}
	}

	/**
	 * The choice between the classic way of working, with Google Earth Desktop, and the new Google Earth Web one, which is in
	 * beta. It is the same setting as the plot viewer of the options dialog, which also offers the plots map alone: while that
	 * one is chosen neither button is selected.
	 */
	private JPanel createViewerChoicePanel() {
		classicViewerButton = createViewerButton(LocalPropertiesService.VIEWER_TYPE_GOOGLE_EARTH_PRO, MaterialDesign.MDI_EARTH,
				"<html><b>" + Messages.getString("CollectEarthWindow.viewerClassic") + "</b><br>" //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
						+ Messages.getString("CollectEarthWindow.viewerClassicDetail") + "</html>"); //$NON-NLS-1$ //$NON-NLS-2$
		newViewerButton = createViewerButton(LocalPropertiesService.VIEWER_TYPE_GOOGLE_EARTH_WEB, MaterialDesign.MDI_WEB,
				"<html><b>" + Messages.getString("CollectEarthWindow.viewerNew") + "</b> <font color='#c05a00'><b>" //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
						+ Messages.getString("CollectEarthWindow.viewerBeta") + "</b></font><br>" //$NON-NLS-1$ //$NON-NLS-2$
						+ Messages.getString("CollectEarthWindow.viewerNewDetail") + "</html>"); //$NON-NLS-1$ //$NON-NLS-2$

		viewerButtons = new ButtonGroup();
		viewerButtons.add(classicViewerButton);
		viewerButtons.add(newViewerButton);
		showViewerType();

		final JPanel panel = new JPanel(new GridLayout(1, 2, 8, 0));
		panel.setBorder(BorderFactory.createCompoundBorder(
				BorderFactory.createTitledBorder(Messages.getString("CollectEarthWindow.viewerChoice")), //$NON-NLS-1$
				BorderFactory.createEmptyBorder(2, 6, 6, 6)));
		panel.add(classicViewerButton);
		panel.add(newViewerButton);
		return panel;
	}

	private JToggleButton createViewerButton(String viewerType, MaterialDesign icon, String text) {
		final JToggleButton button = new JToggleButton(text, FontIcon.of(icon, 24));
		// the look and feel shows the selected one in grey, which reads as switched off: blue with a tick instead
		button.setSelectedIcon(FontIcon.of(MaterialDesign.MDI_CHECK_CIRCLE, 24, SELECTED_VIEWER_COLOR));
		button.putClientProperty("FlatLaf.style", "selectedBackground: #d6e9f7; selectedForeground: #0d3a5c"); //$NON-NLS-1$ //$NON-NLS-2$
		button.setHorizontalAlignment(SwingConstants.LEFT);
		button.setIconTextGap(10);
		// what this way of working means, as the options dialog explains it
		button.setToolTipText("<html><div style='width:300px'>" //$NON-NLS-1$
				+ Messages.getString("ExternalServicesPanel.viewerHelp." + viewerType) + "</div></html>"); //$NON-NLS-1$ //$NON-NLS-2$
		// only a click by the user fires it, not the selection that follows the setting in showViewerType
		button.addActionListener(e -> {
			if (!viewerType.equals(localPropertiesService.getViewerType())) {
				localPropertiesService.saveViewerType(viewerType);
				logger.info("Plot viewer changed from the main window to {}", viewerType); //$NON-NLS-1$
				showViewerType();
				// opens the plots in the chosen viewer, as applying the options dialog does
				EarthApp.executeKmlLoadAsynchronously(getFrame());
			}
		});
		return button;
	}

	/**
	 * How the plots map and the imagery window share the screens (the setting of the options dialog), and a button to put
	 * them back in place: here, where it is easy to find while working, rather than only in the options. The imagery
	 * sources are tabs of the one imagery window, so there are no other windows to bring forward.
	 */
	private JPanel createBrowserWindowsPanel() {
		windowLayoutCombo = new JComboBox<>(new String[] { LocalPropertiesService.WINDOW_LAYOUT_AUTO,
				LocalPropertiesService.WINDOW_LAYOUT_SIDE_BY_SIDE, LocalPropertiesService.WINDOW_LAYOUT_SEPARATE_SCREENS,
				LocalPropertiesService.WINDOW_LAYOUT_IMAGERY_FULL_SCREEN,
				LocalPropertiesService.WINDOW_LAYOUT_PLOTS_MAP_IN_EARTH });
		windowLayoutCombo.setRenderer(new DefaultListCellRenderer() {
			private static final long serialVersionUID = 1L;

			@Override
			public java.awt.Component getListCellRendererComponent(JList<?> list, Object value, int index, boolean isSelected,
					boolean cellHasFocus) {
				String label = Messages.getString("ExternalServicesPanel.windowLayout." + value); //$NON-NLS-1$
				return super.getListCellRendererComponent(list, label, index, isSelected, cellHasFocus);
			}
		});
		windowLayoutCombo.setToolTipText(Messages.getString("ExternalServicesPanel.windowLayoutTooltip")); //$NON-NLS-1$
		windowLayoutCombo.setSelectedItem(localPropertiesService.getWindowLayout());
		// only a choice of the user fires it, not the selection that follows the setting in showViewerType
		windowLayoutCombo.addActionListener(e -> {
			final String layout = (String) windowLayoutCombo.getSelectedItem();
			if (layout != null && !layout.equals(localPropertiesService.getWindowLayout())) {
				localPropertiesService.saveWindowLayout(layout);
				logger.info("Window layout changed from the main window to {}", layout); //$NON-NLS-1$
				inBackground("Arrange the browser windows", windowLayoutService::arrangeAndBringForward); //$NON-NLS-1$
			}
		});

		final JButton arrangeButton = new JButton(Messages.getString("CollectEarthWindow.arrangeWindows"), //$NON-NLS-1$
				FontIcon.of(MaterialDesign.MDI_VIEW_QUILT, 18));
		arrangeButton.setToolTipText(Messages.getString("CollectEarthWindow.arrangeWindowsTooltip")); //$NON-NLS-1$
		arrangeButton.addActionListener(e -> inBackground("Arrange the browser windows", //$NON-NLS-1$
				windowLayoutService::arrangeAndBringForward));

		browserWindowsPanel = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
		browserWindowsPanel.setBorder(BorderFactory.createCompoundBorder(
				BorderFactory.createTitledBorder(Messages.getString("CollectEarthWindow.browserWindows")), //$NON-NLS-1$
				BorderFactory.createEmptyBorder(0, 2, 4, 2)));
		browserWindowsPanel.add(new JLabel(Messages.getString("ExternalServicesPanel.windowLayout"))); //$NON-NLS-1$
		browserWindowsPanel.add(windowLayoutCombo);
		browserWindowsPanel.add(arrangeButton);
		return browserWindowsPanel;
	}

	/** The browsers are driven through Selenium, which waits on them: never on the event thread. */
	private void inBackground(String name, Runnable task) {
		new Thread(() -> {
			try {
				task.run();
			} catch (final Exception e) {
				logger.warn("{} failed", name, e); //$NON-NLS-1$
			}
		}, name).start();
	}

	/**
	 * Selects the button of the viewer in the settings, which the options dialog may have changed, and shows the browser
	 * windows panel only while the plots map is the viewer (with or without Google Earth Web: there is an imagery window
	 * to place either way).
	 */
	private void showViewerType() {
		if (viewerButtons == null) {
			return;
		}
		final String viewerType = localPropertiesService.getViewerType();
		if (browserWindowsPanel != null) {
			final boolean plotsMap = localPropertiesService.isPlotsMapViewer();
			windowLayoutCombo.setSelectedItem(localPropertiesService.getWindowLayout());
			if (browserWindowsPanel.isVisible() != plotsMap) {
				browserWindowsPanel.setVisible(plotsMap);
				// the window cannot be resized by the user: it takes the size of what it shows
				getFrame().pack();
			}
		}
		if (LocalPropertiesService.VIEWER_TYPE_GOOGLE_EARTH_PRO.equals(viewerType)) {
			classicViewerButton.setSelected(true);
		} else if (LocalPropertiesService.VIEWER_TYPE_GOOGLE_EARTH_WEB.equals(viewerType)) {
			newViewerButton.setSelected(true);
		} else {
			viewerButtons.clearSelection();
		}
	}

	private void initializeWindow() {

		// Initialize the translations
		Messages.setLocale(localPropertiesService.getUiLanguage().getLocale());
		getFrame().setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
		getFrame().setResizable(false);
		try {
			getFrame().setIconImage(
					new ImageIcon(new File("images/smallOpenForisBanner.png").toURI().toURL()).getImage()); //$NON-NLS-1$
		} catch (final MalformedURLException e2) {
			logger.error(Messages.getString("CollectEarthWindow.21"), e2); //$NON-NLS-1$
		}

		addWindowClosingListener();
	}

	protected void openWindow() {
		initializeWindow();
		initializePanel();
		initializeMenu();
		displayWindow();

		if (StringUtils.isBlank(getOperator())) {
			if (localPropertiesService.isCloudSyncEnabled()) {
				promptCloudLogin();
			} else {
				JOptionPane.showMessageDialog(getFrame(), Messages.getString("CollectEarthWindow.35"), //$NON-NLS-1$
						Messages.getString("CollectEarthWindow.36"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
			}
		}

		changeFrameTitle();
	}

	/**
	 * In cloud mode with no operator set, the user has not logged in to the cloud
	 * project. Offer to log in; on success seed the operator from the username and
	 * refresh the session token.
	 */
	private void promptCloudLogin() {
		int choice = JOptionPane.showConfirmDialog(getFrame(),
				Messages.getString("CollectEarthWindow.cloudNotLoggedIn"), //$NON-NLS-1$
				Messages.getString("CloudLoginDialog.title"), JOptionPane.OK_CANCEL_OPTION, //$NON-NLS-1$
				JOptionPane.WARNING_MESSAGE);
		if (choice != JOptionPane.OK_OPTION) {
			return;
		}
		CloudLoginDialog dialog = new CloudLoginDialog(getFrame(), cloudApiClient,
				localPropertiesService.getCloudSyncUrl(), null);
		dialog.setVisible(true);
		if (dialog.isSucceeded()) {
			localPropertiesService.saveCloudSyncToken(dialog.getResultToken());
			localPropertiesService.saveOperator(dialog.getResultUsername());
			operatorTextField.setText(dialog.getResultUsername());
			changeFrameTitle();
		}
	}

	public void changeFrameTitle() {
		String name = " - No survey loaded";
		if (earthSurveyService.getCollectSurvey() != null) {
			if (!StringUtils.isBlank(earthSurveyService.getCollectSurvey()
					.getProjectName(localPropertiesService.getUiLanguage().getLocale().getLanguage()))) {
				name = " - " + earthSurveyService.getCollectSurvey()
				.getProjectName(localPropertiesService.getUiLanguage().getLocale().getLanguage());
			} else if (!StringUtils.isBlank(earthSurveyService.getCollectSurvey().getProjectName())) {
				name = " - " + earthSurveyService.getCollectSurvey().getProjectName();
			} else {
				name = " - " + earthSurveyService.getCollectSurvey()
				.getDescription(localPropertiesService.getUiLanguage().getLocale().getLanguage());
			}
		}
		if (localPropertiesService.isCloudSyncEnabled()) {
			name = name + Messages.getString("CollectEarthWindow.cloudTitleSuffix"); //$NON-NLS-1$
		}
		getFrame().setTitle(Messages.getString("CollectEarthWindow.19") + name);
	}

	void setFrame(JFrame frame) {
		this.frame = frame;
	}

}
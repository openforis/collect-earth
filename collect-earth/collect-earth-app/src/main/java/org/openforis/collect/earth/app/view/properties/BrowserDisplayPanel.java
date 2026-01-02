package org.openforis.collect.earth.app.view.properties;

import java.awt.Color;
import java.awt.GridBagConstraints;
import java.awt.GridLayout;
import java.io.File;
import java.util.HashMap;

import javax.swing.ButtonGroup;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JRadioButton;
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;
import javax.swing.border.TitledBorder;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.CollectEarthWindow;
import org.openforis.collect.earth.app.view.JFilePicker;
import org.openforis.collect.earth.app.view.JFilePicker.DlgMode;
import org.openforis.collect.earth.app.view.Messages;

/**
 * Panel for configuring browser and display options.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class BrowserDisplayPanel extends AbstractPropertyPanel {

    private static final long serialVersionUID = 1L;

    private final transient AnalysisSaikuService saikuService;

    // Browser radio buttons
    private JRadioButton firefoxChooser;
    private JRadioButton chromeChooser;
    private JRadioButton edgeChooser;

    // Other components
    private JFilePicker saikuPath;
    private JCheckBox openInSeparateWindow;

    // Callback for restart notification
    private Runnable restartRequiredCallback;

    /**
     * Creates a new browser display panel.
     */
    public BrowserDisplayPanel(LocalPropertiesService localPropertiesService,
                               HashMap<Enum<?>, JComponent[]> propertyToComponent,
                               HashMap<JComponent, JLabel> componentToRowLabel,
                               AnalysisSaikuService saikuService) {
        super(localPropertiesService, propertyToComponent, componentToRowLabel);
        this.saikuService = saikuService;
        buildPanel();
    }

    /**
     * Sets a callback to be invoked when a restart is required.
     */
    public void setRestartRequiredCallback(Runnable callback) {
        this.restartRequiredCallback = callback;
    }

    @Override
    protected void buildPanel() {
        initializeComponents();
        layoutComponents();
    }

    private void initializeComponents() {
        // Browser chooser radio buttons
        String currentBrowser = localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim();

        firefoxChooser = componentFactory.createRadioButton(
                "Firefox",
                EarthConstants.FIREFOX_BROWSER,
                currentBrowser.equals(EarthConstants.FIREFOX_BROWSER));

        chromeChooser = componentFactory.createRadioButton(
                "Chrome",
                EarthConstants.CHROME_BROWSER,
                currentBrowser.equals(EarthConstants.CHROME_BROWSER));

        edgeChooser = componentFactory.createRadioButton(
                "Edge",
                EarthConstants.EDGE_BROWSER,
                currentBrowser.equals(EarthConstants.EDGE_BROWSER));

        registerComponent(EarthProperty.BROWSER_TO_USE, firefoxChooser, chromeChooser, edgeChooser);

        // Saiku path picker
        saikuPath = new JFilePicker(
                Messages.getString("OptionWizard.65"),
                localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER),
                Messages.getString("OptionWizard.66"),
                DlgMode.MODE_OPEN);
        saikuPath.setFolderChooser();
        setupSaikuPathValidation();
        registerComponent(EarthProperty.SAIKU_SERVER_FOLDER, saikuPath);

        // Open in separate window
        openInSeparateWindow = componentFactory.createCheckbox(
                "OptionWizard.48",
                EarthProperty.OPEN_BALLOON_IN_BROWSER);
        registerComponent(EarthProperty.OPEN_BALLOON_IN_BROWSER, openInSeparateWindow);
    }

    private void setupSaikuPathValidation() {
        saikuPath.addChangeListener(new DocumentListener() {
            @Override
            public void removeUpdate(DocumentEvent e) {
                // Not used
            }

            @Override
            public void insertUpdate(DocumentEvent e) {
                validateSaikuPath();
            }

            @Override
            public void changedUpdate(DocumentEvent e) {
                // Not used
            }

            private void validateSaikuPath() {
                File saikuFolder = new File(saikuPath.getSelectedFilePath());
                if (!saikuService.isSaikuFolder(saikuFolder)) {
                    JOptionPane.showMessageDialog(
                            BrowserDisplayPanel.this,
                            Messages.getString("OptionWizard.27"),
                            Messages.getString("OptionWizard.28"),
                            JOptionPane.INFORMATION_MESSAGE);
                    saikuPath.getTextField().setBackground(CollectEarthWindow.ERROR_COLOR);
                } else {
                    saikuPath.getTextField().setBackground(Color.white);
                }
            }
        });
    }

    private void layoutComponents() {
        GridBagConstraints constraints = GridBagConstraintsBuilder.createDefault();

        // Browser chooser panel
        JPanel browserChooserPanel = createBrowserChooserPanel();
        add(browserChooserPanel, constraints);

        // Saiku server folder
        constraints = new GridBagConstraintsBuilder()
                .gridy(1)
                .build();
        add(saikuPath, constraints);

        // Open in separate window checkbox
        constraints = new GridBagConstraintsBuilder()
                .gridy(2)
                .build();
        add(openInSeparateWindow, constraints);
    }

    private JPanel createBrowserChooserPanel() {
        JPanel panel = new JPanel();
        Border border = new TitledBorder(
                new BevelBorder(BevelBorder.LOWERED),
                Messages.getString("OptionWizard.1"));
        panel.setBorder(border);
        panel.setLayout(new GridLayout(0, 1));

        ButtonGroup browserChooser = new ButtonGroup();

        // Add restart listener to all browser radio buttons
        java.awt.event.ActionListener restartListener = e -> {
            if (restartRequiredCallback != null) {
                restartRequiredCallback.run();
            }
        };

        for (JRadioButton radioButton : new JRadioButton[] { firefoxChooser, chromeChooser, edgeChooser }) {
            panel.add(radioButton);
            browserChooser.add(radioButton);
            radioButton.addActionListener(restartListener);
        }

        return panel;
    }

    // ========== Getters ==========

    public JRadioButton getFirefoxChooser() {
        return firefoxChooser;
    }

    public JRadioButton getChromeChooser() {
        return chromeChooser;
    }

    public JRadioButton getEdgeChooser() {
        return edgeChooser;
    }

    public JFilePicker getSaikuPath() {
        return saikuPath;
    }

    public JCheckBox getOpenInSeparateWindow() {
        return openInSeparateWindow;
    }
}

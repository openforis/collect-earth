package org.openforis.collect.earth.app.view.properties;

import javax.swing.SwingWorker;
import java.util.Arrays;
import java.awt.Component;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.event.ActionListener;
import java.io.IOException;
import java.util.HashMap;

import javax.swing.AbstractAction;
import javax.swing.BorderFactory;
import javax.swing.ButtonGroup;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JRadioButton;
import javax.swing.JScrollPane;
import javax.swing.JTextField;
import javax.swing.ScrollPaneConstants;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;

/**
 * Panel for configuring database and server settings.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class DatabaseServerPanel extends AbstractPropertyPanel {

    private static final long serialVersionUID = 1L;

    // Server components
    private JTextField serverPort;

    // Database type components
    private JRadioButton sqliteDbType;
    private JRadioButton postgresDbType;

    // PostgreSQL components
    private JPanel postgresPanel;
    private JTextField dbUsername;
    private JPasswordField dbPassword;
    private JTextField dbName;
    private JTextField dbHost;
    private JTextField dbPort;

    // SQLite components
    private JPanel sqlitePanel;
    private JCheckBox automaticBackup;

    // Callback for restart notification
    private Runnable restartRequiredCallback;
    private String backupFolder;

    /**
     * Creates a new database server panel.
     */
    public DatabaseServerPanel(LocalPropertiesService localPropertiesService,
                               HashMap<Enum<?>, JComponent[]> propertyToComponent,
                               HashMap<JComponent, JLabel> componentToRowLabel,
                               String backupFolder) {
        super(localPropertiesService, propertyToComponent, componentToRowLabel);
        this.backupFolder = backupFolder;
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

        // Create main panel
        JPanel mainPanel = new JPanel(new GridBagLayout());
        mainPanel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));

        GridBagConstraints constraints = new GridBagConstraintsBuilder()
                .gridy(0)
                .weighty(1.0)
                .fill(GridBagConstraints.BOTH)
                .build();

        // Add server panel
        JPanel serverPanel = createServerPanel();
        mainPanel.add(serverPanel, constraints);

        JScrollPane scrollPane = new JScrollPane(mainPanel,
                ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        add(scrollPane, GridBagConstraintsBuilder.createFillBoth(0, 0));
    }

    private void initializeComponents() {
        // Server port
        serverPort = componentFactory.createTextField(EarthProperty.HOST_PORT_KEY);
        registerComponent(EarthProperty.HOST_PORT_KEY, serverPort);

        // Database types
        boolean usingPostgreSQL = localPropertiesService.getCollectDBDriver().equals(CollectDBDriver.POSTGRESQL);

        sqliteDbType = componentFactory.createRadioButton(
                Messages.getString("OptionWizard.93"),
                CollectDBDriver.SQLITE.name(),
                !usingPostgreSQL);

        postgresDbType = componentFactory.createRadioButton(
                Messages.getString("OptionWizard.94"),
                CollectDBDriver.POSTGRESQL.name(),
                usingPostgreSQL);

        registerComponent(EarthProperty.DB_DRIVER, sqliteDbType, postgresDbType);

        // PostgreSQL fields
        dbUsername = componentFactory.createValidatedTextField(
                EarthProperty.DB_USERNAME,
                PropertyValidators.requiredFieldValidator(),
                Messages.getString("OptionWizard.1032"));
        registerComponent(EarthProperty.DB_USERNAME, dbUsername);

        dbPassword = componentFactory.createPasswordField(EarthProperty.DB_PASSWORD);
        dbPassword.setToolTipText(Messages.getString("OptionWizard.1033"));
        registerComponent(EarthProperty.DB_PASSWORD, dbPassword);

        dbName = componentFactory.createValidatedTextField(
                EarthProperty.DB_NAME,
                PropertyValidators.requiredFieldValidator(),
                Messages.getString("OptionWizard.1034"));
        registerComponent(EarthProperty.DB_NAME, dbName);

        dbHost = componentFactory.createValidatedTextField(
                EarthProperty.DB_HOST,
                PropertyValidators.requiredFieldValidator(),
                Messages.getString("OptionWizard.1035"));
        registerComponent(EarthProperty.DB_HOST, dbHost);

        dbPort = componentFactory.createValidatedTextField(
                EarthProperty.DB_PORT,
                PropertyValidators.portValidator(),
                Messages.getString("OptionWizard.1036"));
        registerComponent(EarthProperty.DB_PORT, dbPort);

        // SQLite backup
        automaticBackup = componentFactory.createCheckbox("OptionWizard.44", EarthProperty.AUTOMATIC_BACKUP);
        registerComponent(EarthProperty.AUTOMATIC_BACKUP, automaticBackup);

        // Create sub-panels
        postgresPanel = createPostgreSqlPanel();
        sqlitePanel = createSqlitePanel();

        // Initialize enabled state
        enableDBOptions(usingPostgreSQL);
    }

    private JPanel createServerPanel() {
        JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(createRaisedTitledBorder(Messages.getString("OptionWizard.3")));

        // Server information
        JLabel serverInfo = new JLabel(Messages.getString("OptionWizard.4") + CollectEarthUtils.getComputerIp());
        panel.add(serverInfo, GridBagConstraintsBuilder.createDefault());

        addLabeledRow(panel, 1, "OptionWizard.5", serverPort);

        // Database type radio buttons
        ButtonGroup buttonGroup = new ButtonGroup();
        buttonGroup.add(sqliteDbType);
        buttonGroup.add(postgresDbType);

        ActionListener dbTypeListener = e -> {
            JRadioButton source = (JRadioButton) e.getSource();
            boolean isPostgreDb = source.getName().equals(CollectDBDriver.POSTGRESQL.name());
            enableDBOptions(isPostgreDb);
        };

        ActionListener restartListener = e -> {
            if (restartRequiredCallback != null) {
                restartRequiredCallback.run();
            }
        };

        sqliteDbType.addActionListener(dbTypeListener);
        sqliteDbType.addActionListener(restartListener);
        postgresDbType.addActionListener(dbTypeListener);
        postgresDbType.addActionListener(restartListener);

        addFullWidthRow(panel, 2, sqliteDbType);
        addFullWidthRow(panel, 3, sqlitePanel);
        addFullWidthRow(panel, 4, postgresDbType);
        addFullWidthRow(panel, 5, postgresPanel);

        return panel;
    }

    private JPanel createPostgreSqlPanel() {
        JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(createRaisedTitledBorder(Messages.getString("OptionWizard.6")));

        addLabeledRow(panel, 0, "OptionWizard.7", dbUsername);
        addLabeledRow(panel, 1, "OptionWizard.8", dbPassword);
        addLabeledRow(panel, 2, "OptionWizard.9", dbName);
        addLabeledRow(panel, 3, "OptionWizard.26", dbHost);
        addLabeledRow(panel, 4, "OptionWizard.29", dbPort);
        // Default port hint next to the port field
        panel.add(new JLabel(Messages.getString("OptionWizard.134")),
                new GridBagConstraintsBuilder().gridx(2).gridy(4).build());

        panel.add(createTestConnectionButton(), new GridBagConstraintsBuilder().gridx(1).gridy(5).build());

        return panel;
    }

    private JPanel createSqlitePanel() {
        JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(createRaisedTitledBorder(Messages.getString("OptionWizard.30")));

        panel.add(automaticBackup, GridBagConstraintsBuilder.createDefault());
        panel.add(createOpenBackupFolderButton(), new GridBagConstraintsBuilder().gridx(1).gridy(0).build());

        return panel;
    }

    private JButton createTestConnectionButton() {
        JButton button = new JButton(Messages.getString("OptionWizard.135"));
        button.addActionListener(e -> {
            String host = dbHost.getText();
            String port = dbPort.getText();
            String database = dbName.getText();
            String username = dbUsername.getText();
            // getPassword() rather than the deprecated getText() of the text field it extends
            char[] passwordChars = dbPassword.getPassword();
            String password = new String(passwordChars);
            Arrays.fill(passwordChars, ' ');

            // Off the event thread : testing an unreachable host used to freeze the whole interface until the network gave up
            button.setEnabled(false);
            new SwingWorker<String, Void>() {
                @Override
                protected String doInBackground() {
                    return CollectEarthUtils.testPostgreSQLConnection(host, port, database, username, password);
                }

                @Override
                protected void done() {
                    button.setEnabled(true);
                    String message;
                    try {
                        message = get();
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        return;
                    } catch (Exception ex) {
                        message = ex.getMessage();
                    }
                    JOptionPane.showMessageDialog(
                            DatabaseServerPanel.this.getTopLevelAncestor(),
                            message,
                            Messages.getString("OptionWizard.1037"),
                            JOptionPane.INFORMATION_MESSAGE);
                }
            }.execute();
        });
        return button;
    }

    private Component createOpenBackupFolderButton() {
        AbstractAction backupAction = new AbstractAction(Messages.getString("OptionWizard.10")) {
            private static final long serialVersionUID = 1L;

            @Override
            public void actionPerformed(java.awt.event.ActionEvent e) {
                try {
                    CollectEarthUtils.openFolderInExplorer(backupFolder);
                } catch (IOException ex) {
                    logger.error("Error when opening the explorer window to visualize backups", ex);
                }
            }
        };
        return new JButton(backupAction);
    }

    /**
     * Enable or disable database options based on database type.
     */
    private void enableDBOptions(boolean isPostgreDb) {
        enableContainer(postgresPanel, isPostgreDb);
        enableContainer(sqlitePanel, !isPostgreDb);
    }

    // ========== Getters ==========

    public JTextField getServerPort() {
        return serverPort;
    }

    public JRadioButton getSqliteDbType() {
        return sqliteDbType;
    }

    public JRadioButton getPostgresDbType() {
        return postgresDbType;
    }

    public JPanel getPostgresPanel() {
        return postgresPanel;
    }

    public JPanel getSqlitePanel() {
        return sqlitePanel;
    }
}

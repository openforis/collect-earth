package org.openforis.collect.earth.app.view.properties;

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
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;
import javax.swing.border.TitledBorder;

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
                "Database username for PostgreSQL connection");
        registerComponent(EarthProperty.DB_USERNAME, dbUsername);

        dbPassword = componentFactory.createPasswordField(EarthProperty.DB_PASSWORD);
        dbPassword.setToolTipText("Database password for PostgreSQL connection");
        registerComponent(EarthProperty.DB_PASSWORD, dbPassword);

        dbName = componentFactory.createValidatedTextField(
                EarthProperty.DB_NAME,
                PropertyValidators.requiredFieldValidator(),
                "Name of the PostgreSQL database to connect to");
        registerComponent(EarthProperty.DB_NAME, dbName);

        dbHost = componentFactory.createValidatedTextField(
                EarthProperty.DB_HOST,
                PropertyValidators.requiredFieldValidator(),
                "Hostname or IP address of the PostgreSQL server");
        registerComponent(EarthProperty.DB_HOST, dbHost);

        dbPort = componentFactory.createValidatedTextField(
                EarthProperty.DB_PORT,
                PropertyValidators.portValidator(),
                "Port number for PostgreSQL connection (default: 5432)");
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
        Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
                Messages.getString("OptionWizard.3"));
        panel.setBorder(border);

        GridBagConstraints constraints = GridBagConstraintsBuilder.createDefault();

        // Server information
        JLabel serverInfo = new JLabel(Messages.getString("OptionWizard.4") + CollectEarthUtils.getComputerIp());
        panel.add(serverInfo, constraints);

        // Port
        constraints = GridBagConstraintsBuilder.createLabel(0, 1);
        panel.add(new JLabel(Messages.getString("OptionWizard.5")), constraints);

        constraints = GridBagConstraintsBuilder.createField(1, 1);
        panel.add(serverPort, constraints);

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

        // Add SQLite option
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(2)
                .gridwidth(GridBagConstraints.REMAINDER)
                .build();
        panel.add(sqliteDbType, constraints);

        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(3)
                .gridwidth(GridBagConstraints.REMAINDER)
                .build();
        panel.add(sqlitePanel, constraints);

        // Add PostgreSQL option
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(4)
                .gridwidth(GridBagConstraints.REMAINDER)
                .build();
        panel.add(postgresDbType, constraints);

        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(5)
                .gridwidth(GridBagConstraints.REMAINDER)
                .build();
        panel.add(postgresPanel, constraints);

        return panel;
    }

    private JPanel createPostgreSqlPanel() {
        JPanel panel = new JPanel(new GridBagLayout());
        Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
                Messages.getString("OptionWizard.6"));
        panel.setBorder(border);

        GridBagConstraints constraints;

        // Username
        constraints = GridBagConstraintsBuilder.createLabel(0, 0);
        panel.add(new JLabel(Messages.getString("OptionWizard.7")), constraints);
        constraints = GridBagConstraintsBuilder.createField(1, 0);
        panel.add(dbUsername, constraints);

        // Password
        constraints = GridBagConstraintsBuilder.createLabel(0, 1);
        panel.add(new JLabel(Messages.getString("OptionWizard.8")), constraints);
        constraints = GridBagConstraintsBuilder.createField(1, 1);
        panel.add(dbPassword, constraints);

        // Database name
        constraints = GridBagConstraintsBuilder.createLabel(0, 2);
        panel.add(new JLabel(Messages.getString("OptionWizard.9")), constraints);
        constraints = GridBagConstraintsBuilder.createField(1, 2);
        panel.add(dbName, constraints);

        // Host
        constraints = GridBagConstraintsBuilder.createLabel(0, 3);
        panel.add(new JLabel(Messages.getString("OptionWizard.26")), constraints);
        constraints = GridBagConstraintsBuilder.createField(1, 3);
        panel.add(dbHost, constraints);

        // Port
        constraints = GridBagConstraintsBuilder.createLabel(0, 4);
        panel.add(new JLabel(Messages.getString("OptionWizard.29")), constraints);
        constraints = GridBagConstraintsBuilder.createField(1, 4);
        panel.add(dbPort, constraints);
        constraints = new GridBagConstraintsBuilder()
                .gridx(2)
                .gridy(4)
                .build();
        panel.add(new JLabel(Messages.getString("OptionWizard.134")), constraints);

        // Test connection button
        constraints = new GridBagConstraintsBuilder()
                .gridx(1)
                .gridy(5)
                .build();
        panel.add(createTestConnectionButton(), constraints);

        return panel;
    }

    private JPanel createSqlitePanel() {
        JPanel panel = new JPanel(new GridBagLayout());
        Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
                Messages.getString("OptionWizard.30"));
        panel.setBorder(border);

        GridBagConstraints constraints = GridBagConstraintsBuilder.createDefault();
        panel.add(automaticBackup, constraints);

        constraints = new GridBagConstraintsBuilder()
                .gridx(1)
                .gridy(0)
                .build();
        panel.add(createOpenBackupFolderButton(), constraints);

        return panel;
    }

    private JButton createTestConnectionButton() {
        JButton button = new JButton(Messages.getString("OptionWizard.135"));
        button.addActionListener(e -> {
            String host = dbHost.getText();
            String port = dbPort.getText();
            String database = dbName.getText();
            String username = dbUsername.getText();
            String password = dbPassword.getText();

            String message = CollectEarthUtils.testPostgreSQLConnection(host, port, database, username, password);
            JOptionPane.showMessageDialog(
                    DatabaseServerPanel.this.getTopLevelAncestor(),
                    message,
                    "PostgreSQL Connection test",
                    JOptionPane.INFORMATION_MESSAGE);
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

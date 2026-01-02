package org.openforis.collect.earth.app.view.properties;

import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.awt.Window;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;

import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.ListSelectionModel;
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;
import javax.swing.border.TitledBorder;

import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.DataFormat;
import org.openforis.collect.earth.app.view.JFileChooserExistsAware;
import org.openforis.collect.earth.app.view.Messages;

/**
 * Panel for managing Collect Earth projects.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class ProjectsPanel extends AbstractPropertyPanel {

    private static final long serialVersionUID = 1L;

    private final transient EarthProjectsService projectsService;
    private JList<String> projectsList;
    private JButton openProjectButton;

    // Callbacks
    private Runnable onProjectImport;
    private Runnable onProjectLoad;

    /**
     * Creates a new projects panel.
     */
    public ProjectsPanel(LocalPropertiesService localPropertiesService,
                         HashMap<Enum<?>, JComponent[]> propertyToComponent,
                         HashMap<JComponent, JLabel> componentToRowLabel,
                         EarthProjectsService projectsService) {
        super(localPropertiesService, propertyToComponent, componentToRowLabel);
        this.projectsService = projectsService;
        buildPanel();
    }

    /**
     * Sets the callback to invoke when a project is imported.
     */
    public void setOnProjectImport(Runnable callback) {
        this.onProjectImport = callback;
    }

    /**
     * Sets the callback to invoke when a project is loaded.
     */
    public void setOnProjectLoad(Runnable callback) {
        this.onProjectLoad = callback;
    }

    @Override
    protected void buildPanel() {
        GridBagConstraints constraints = new GridBagConstraintsBuilder()
                .fill(GridBagConstraints.BOTH)
                .build();

        // Import new project button
        JButton importNewButton = createImportProjectButton();
        add(importNewButton, constraints);

        // Projects list panel
        JPanel projectsListPanel = createProjectsListPanel();
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(1)
                .fill(GridBagConstraints.BOTH)
                .build();
        add(projectsListPanel, constraints);
    }

    private JButton createImportProjectButton() {
        JButton button = new JButton(Messages.getString("OptionWizard.41"));
        button.addActionListener(e -> {
            if (importProject()) {
                if (onProjectImport != null) {
                    onProjectImport.run();
                }
            }
        });
        return button;
    }

    private boolean importProject() {
        Window parentWindow = (Window) getTopLevelAncestor();
        JFrame parentFrame = parentWindow instanceof JFrame ? (JFrame) parentWindow : null;

        File[] selectedProjectFile = JFileChooserExistsAware.getFileChooserResults(
                DataFormat.PROJECT_DEFINITION_FILE, false, false, null,
                localPropertiesService, parentFrame);

        if (selectedProjectFile != null && selectedProjectFile.length == 1) {
            try {
                projectsService.loadCompressedProjectFile(selectedProjectFile[0]);
                return true;
            } catch (Exception e) {
                JOptionPane.showMessageDialog(
                        this,
                        e.getMessage(),
                        Messages.getString("OptionWizard.51"),
                        JOptionPane.ERROR_MESSAGE);
                logger.error("Error importing project file " + selectedProjectFile[0].getAbsolutePath(), e);
            }
        }
        return false;
    }

    private JPanel createProjectsListPanel() {
        JPanel panel = new JPanel(new java.awt.GridBagLayout());
        Border border = new TitledBorder(
                new BevelBorder(BevelBorder.RAISED),
                Messages.getString("OptionWizard.57"));
        panel.setBorder(border);

        GridBagConstraints constraints = GridBagConstraintsBuilder.createDefault();

        // Create projects list
        projectsList = createProjectsList();
        JScrollPane listScroller = new JScrollPane(projectsList);
        listScroller.setPreferredSize(new Dimension(250, 300));

        constraints = new GridBagConstraintsBuilder()
                .gridy(0)
                .gridx(GridBagConstraints.RELATIVE)
                .build();
        panel.add(listScroller, constraints);

        // Open project button
        openProjectButton = createOpenProjectButton();
        openProjectButton.setEnabled(false);
        panel.add(openProjectButton);

        // Update button state when selection changes
        projectsList.addListSelectionListener(e ->
                openProjectButton.setEnabled(projectsList.getSelectedValue() != null));

        return panel;
    }

    private JList<String> createProjectsList() {
        List<String> projectNames = new ArrayList<>(projectsService.getProjectList().keySet());
        Collections.sort(projectNames);

        JList<String> list = new JList<>(projectNames.toArray(new String[0]));
        list.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        list.setLayoutOrientation(JList.VERTICAL);
        list.setVisibleRowCount(-1);
        list.setToolTipText("Double-click a project to load it, or select and use the button below");

        // Add double-click listener to load project
        list.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2 && !e.isConsumed()) {
                    e.consume();
                    int index = list.locationToIndex(e.getPoint());
                    if (index >= 0) {
                        list.setSelectedIndex(index);
                        loadSelectedProject();
                    }
                }
            }
        });

        return list;
    }

    private JButton createOpenProjectButton() {
        JButton button = new JButton(Messages.getString("OptionWizard.56"));
        button.addActionListener(e -> loadSelectedProject());
        return button;
    }

    private void loadSelectedProject() {
        if (openSelectedProject()) {
            if (onProjectLoad != null) {
                onProjectLoad.run();
            }
        }
    }

    private boolean openSelectedProject() {
        String selectedProject = projectsList.getSelectedValue();
        if (selectedProject != null) {
            File projectFolder = projectsService.getProjectList().get(selectedProject);
            try {
                projectsService.loadProjectInFolder(projectFolder);
                return true;
            } catch (Exception e) {
                JOptionPane.showMessageDialog(
                        this,
                        e.getMessage(),
                        Messages.getString("OptionWizard.55"),
                        JOptionPane.ERROR_MESSAGE);
                logger.error("Error importing project folder " + projectFolder.getAbsolutePath(), e);
            }
        }
        return false;
    }

    /**
     * Refreshes the projects list.
     */
    public void refreshProjectsList() {
        List<String> projectNames = new ArrayList<>(projectsService.getProjectList().keySet());
        Collections.sort(projectNames);
        projectsList.setListData(projectNames.toArray(new String[0]));
    }

    // ========== Getters ==========

    public JList<String> getProjectsList() {
        return projectsList;
    }

    public JButton getOpenProjectButton() {
        return openProjectButton;
    }
}

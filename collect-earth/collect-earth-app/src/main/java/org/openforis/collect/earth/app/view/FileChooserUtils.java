package org.openforis.collect.earth.app.view;

import java.io.File;
import java.lang.reflect.Method;

import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.swing.filechooser.FileFilter;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * File chooser helper that prefers the existence-aware chooser when available.
 * Falls back to a standard JFileChooser if the class is missing at runtime.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public final class FileChooserUtils {

    private static final Logger logger = LoggerFactory.getLogger(FileChooserUtils.class);
    private static final String EXISTS_AWARE_CLASS =
            "org.openforis.collect.earth.app.view.JFileChooserExistsAware";
    /** Resolved once. Null means the class is really absent, so a null result can only mean that the user cancelled */
    private static final Method EXISTS_AWARE_METHOD = resolveExistsAwareMethod();

    private static Method resolveExistsAwareMethod() {
        try {
            return Class.forName(EXISTS_AWARE_CLASS).getMethod(
                    "getFileChooserResults",
                    DataFormat.class,
                    boolean.class,
                    boolean.class,
                    String.class,
                    LocalPropertiesService.class,
                    JFrame.class,
                    File.class);
        } catch (ClassNotFoundException | NoSuchMethodException e) {
            logger.warn("JFileChooserExistsAware missing at runtime, using fallback chooser.");
            return null;
        }
    }

    private FileChooserUtils() {
        // Utility class
    }

    public static File[] getFileChooserResults(final DataFormat dataFormat, boolean isSaveDlg,
                                               boolean multipleSelect, String preselectedName,
                                               LocalPropertiesService localPropertiesService, JFrame frame) {
        return getFileChooserResults(dataFormat, isSaveDlg, multipleSelect, preselectedName,
                localPropertiesService, frame, null);
    }

    public static File[] getFileChooserResults(final DataFormat dataFormat, boolean isSaveDlg,
                                               boolean multipleSelect, String preselectedName,
                                               LocalPropertiesService localPropertiesService, JFrame frame,
                                               File preSelectedFolder) {
        if (EXISTS_AWARE_METHOD != null) {
            try {
                // A null here means that the user cancelled : return it, do not open a second dialog
                return (File[]) EXISTS_AWARE_METHOD.invoke(null, dataFormat, isSaveDlg, multipleSelect,
                        preselectedName, localPropertiesService, frame, preSelectedFolder);
            } catch (Exception e) {
                logger.warn("Failed to invoke existence-aware file chooser, using fallback chooser.", e);
            }
        }
        return fallbackChooser(dataFormat, isSaveDlg, multipleSelect, preselectedName,
                localPropertiesService, frame, preSelectedFolder);
    }

    private static File[] fallbackChooser(final DataFormat dataFormat, boolean isSaveDlg,
                                          boolean multipleSelect, String preselectedName,
                                          LocalPropertiesService localPropertiesService, JFrame frame,
                                          File preSelectedFolder) {
        File initialFolder = resolveInitialFolder(localPropertiesService, preSelectedFolder);
        JFileChooser chooser = initialFolder == null ? new JFileChooser() : new JFileChooser(initialFolder);

        if (preselectedName != null) {
            File selectedFile = new File(chooser.getCurrentDirectory().getAbsolutePath()
                    + File.separatorChar + preselectedName);
            chooser.setSelectedFile(selectedFile);
        }

        chooser.setMultiSelectionEnabled(multipleSelect);

        FileFilter addedFilter = createFileFilter(dataFormat);
        chooser.addChoosableFileFilter(addedFilter);
        chooser.setAcceptAllFileFilterUsed(true);
        chooser.setFileFilter(addedFilter);

        int returnVal = isSaveDlg ? chooser.showSaveDialog(frame) : chooser.showOpenDialog(frame);
        if (returnVal != JFileChooser.APPROVE_OPTION) {
            return null;
        }

        File[] selectedFiles = multipleSelect
                ? chooser.getSelectedFiles()
                : new File[] { chooser.getSelectedFile() };

        if (selectedFiles == null || selectedFiles.length == 0) {
            return selectedFiles;
        }

        if (isSaveDlg) {
            File approvedFile = handleSaveSelection(selectedFiles[0], chooser, dataFormat);
            if (approvedFile == null) {
                return null;
            }
            selectedFiles[0] = approvedFile;
        }

        localPropertiesService.setValue(EarthProperty.LAST_USED_FOLDER, selectedFiles[0].getParent());
        return selectedFiles;
    }

    private static File resolveInitialFolder(LocalPropertiesService localPropertiesService, File preSelectedFolder) {
        if (preSelectedFolder != null) {
            return preSelectedFolder;
        }
        String lastUsedFolder = localPropertiesService.getValue(EarthProperty.LAST_USED_FOLDER);
        if (!StringUtils.isBlank(lastUsedFolder)) {
            File folder = new File(lastUsedFolder);
            if (folder.exists()) {
                return folder;
            }
        }
        return null;
    }

    private static File handleSaveSelection(File selectedFile, JFileChooser chooser, DataFormat dataFormat) {
        // The name that will really be written, before asking about overwriting it
        selectedFile = dataFormat.withDefaultExtension(selectedFile);
        if (selectedFile.exists()) {
            int result = JOptionPane.showConfirmDialog(chooser,
                    "The file exists, overwrite?",
                    "Existing file",
                    JOptionPane.YES_NO_CANCEL_OPTION);
            if (result != JOptionPane.YES_OPTION) {
                return null;
            }
        }

        return selectedFile;
    }

    private static FileFilter createFileFilter(final DataFormat dataFormat) {
        return new FileFilter() {
            @Override
            public boolean accept(File f) {
                String[] extensions = dataFormat.getPossibleFileExtensions();
                if (f.isDirectory()) {
                    return true;
                }
                for (String extension : extensions) {
                    if (f.getName().toLowerCase().endsWith("." + extension)) {
                        return true;
                    }
                }
                return false;
            }

            @Override
            public String getDescription() {
                return dataFormat.getDescription();
            }
        };
    }
}

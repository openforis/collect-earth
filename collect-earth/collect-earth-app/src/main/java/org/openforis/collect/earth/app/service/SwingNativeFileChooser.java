package org.openforis.collect.earth.app.service;

import java.awt.Dialog;
import java.awt.GraphicsEnvironment;
import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import javax.swing.ImageIcon;
import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;
import javax.swing.filechooser.FileFilter;
import javax.swing.filechooser.FileNameExtensionFilter;
import javax.swing.filechooser.FileSystemView;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.app.view.ShellFolderFallback;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * The file dialog for the pages, made with Swing's JFileChooser. This is the one Swing class meant to outlive the Swing
 * interface: AWT's FileDialog, the alternative without Swing, cannot choose a folder on Windows.
 * <p>
 * It is set up as the choosers of the Swing interface are (FileChooserUtils): through ShellFolderFallback, which keeps
 * it working when the Windows shell folders fail, starting in the last folder used, and asking before a file is
 * overwritten. FileChooserUtils itself is not used as it works with a DataFormat, and the pages name extensions.
 * <p>
 * One dialog at a time: a request that comes while one is open is refused (BusyException) rather than queued.
 */
@Component
public class SwingNativeFileChooser implements NativeFileChooser {

	private static final String ICON = "images/smallOpenForisBanner.png"; //$NON-NLS-1$
	private final Logger logger = LoggerFactory.getLogger(SwingNativeFileChooser.class);
	private final LocalPropertiesService localPropertiesService;
	private final AtomicBoolean open = new AtomicBoolean();

	@Autowired
	public SwingNativeFileChooser(LocalPropertiesService localPropertiesService) {
		this.localPropertiesService = localPropertiesService;
	}

	@Override
	public String choose(Mode mode, List<String> extensions, String suggested) {
		List<File> chosen = showOnce(mode, extensions, suggested, false);
		return chosen.isEmpty() ? null : chosen.get(0).getAbsolutePath();
	}

	@Override
	public List<String> chooseMany(List<String> extensions, String suggested) {
		List<String> paths = new ArrayList<>();
		for (File file : showOnce(Mode.OPEN, extensions, suggested, true)) {
			paths.add(file.getAbsolutePath());
		}
		return paths;
	}

	/** One dialog at a time; the files chosen, none when cancelled; the folder of the choice remembered for the next. */
	private List<File> showOnce(Mode mode, List<String> extensions, String suggested, boolean multiple) {
		if (GraphicsEnvironment.isHeadless()) {
			throw new NoDisplayException();
		}
		if (!open.compareAndSet(false, true)) {
			throw new BusyException();
		}
		// The flag is cleared by the task on the event thread, once the dialog is gone: cleared here, a request whose
		// wait was interrupted would let a second dialog open while the first is still on screen
		List<File> chosen = onEventThread(() -> {
			try {
				return show(mode, extensions, suggested, multiple);
			} finally {
				open.set(false);
			}
		});
		if (chosen.isEmpty()) {
			return chosen;
		}
		File folder = folderToRemember(mode, chosen.get(0));
		if (folder != null) {
			// This runs on an HTTP thread, not the event thread: its observers are notified here, and no observer of
			// LAST_USED_FOLDER touches Swing (LocalPropertiesService has none registered)
			localPropertiesService.setValue(EarthProperty.LAST_USED_FOLDER, folder.getPath());
		}
		return chosen;
	}

	/**
	 * The folder the next dialog starts in: a folder chosen itself, the folder of a file chosen. Null when there is none,
	 * for a root chosen as a file, as a null property would throw.
	 */
	static File folderToRemember(Mode mode, File chosen) {
		return mode == Mode.FOLDER ? chosen : chosen.getParentFile();
	}

	private List<File> show(Mode mode, List<String> extensions, String suggested, boolean multiple) {
		// The parent of the dialog: on top of every window and in the middle of the screen, so the dialog comes up in
		// front of the browser the user is looking at, and not behind it as a dialog of a window-less process would.
		// Titled and with the icon, so its taskbar entry is not blank, and excluded from the modality of the Swing
		// interface's dialogs, so one of them that is open cannot block it
		JFrame parent = new JFrame("Collect Earth"); //$NON-NLS-1$
		try {
			parent.setUndecorated(true);
			parent.setAlwaysOnTop(true);
			parent.setModalExclusionType(Dialog.ModalExclusionType.APPLICATION_EXCLUDE);
			setIcon(parent);
			parent.setSize(0, 0);
			parent.setLocationRelativeTo(null);
			parent.setVisible(true);
			// Windows hands the focus to a window of a process that is not in front only when asked
			parent.toFront();
			parent.requestFocus();

			JFileChooser chooser = mode == Mode.SAVE ? new OverwriteAwareChooser(extensions) : new JFileChooser();
			File start = start(suggested, localPropertiesService.getValue(EarthProperty.LAST_USED_FOLDER),
					FileSystemView.getFileSystemView().getDefaultDirectory());
			if (start != null) {
				if (start.isDirectory()) {
					chooser.setCurrentDirectory(start);
				} else {
					chooser.setSelectedFile(start);
				}
			}
			if (mode == Mode.FOLDER) {
				chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
			} else {
				chooser.setFileSelectionMode(JFileChooser.FILES_ONLY);
				chooser.setMultiSelectionEnabled(multiple);
				FileFilter filter = filter(extensions);
				if (filter != null) {
					chooser.addChoosableFileFilter(filter);
					chooser.setFileFilter(filter);
				}
			}

			int answer = ShellFolderFallback.showDialog(chooser,
					c -> mode == Mode.SAVE ? c.showSaveDialog(parent) : c.showOpenDialog(parent));
			if (answer != JFileChooser.APPROVE_OPTION) {
				return Collections.emptyList();
			}
			if (multiple) {
				return new ArrayList<>(Arrays.asList(chooser.getSelectedFiles()));
			}
			File chosen = chooser.getSelectedFile();
			if (chosen == null && mode == Mode.FOLDER) {
				// Open pressed inside a folder without picking one of its subfolders chooses that folder
				chosen = chooser.getCurrentDirectory();
			}
			if (chosen != null && mode == Mode.SAVE) {
				// OverwriteAwareChooser has done this for the name typed; this covers the other ways in
				chosen = withExtension(chosen, extensions);
			}
			return chosen == null ? Collections.emptyList() : Collections.singletonList(chosen);
		} finally {
			parent.dispose();
		}
	}

	/**
	 * Asks before overwriting a file, as JFileChooserExistsAware does for the Swing interface, after adding the
	 * extension: typing "export" where "export.zip" exists has to ask about export.zip.
	 */
	private static class OverwriteAwareChooser extends JFileChooser {
		private static final long serialVersionUID = 1L;
		private final transient List<String> extensions;

		OverwriteAwareChooser(List<String> extensions) {
			this.extensions = extensions;
		}

		@Override
		public void approveSelection() {
			File file = getSelectedFile();
			if (file != null) {
				file = withExtension(file, extensions);
				setSelectedFile(file);
				if (file.exists()) {
					int answer = JOptionPane.showConfirmDialog(this,
							Messages.getString("JFileChooserExistsAware.overwriteQuestion"), //$NON-NLS-1$
							Messages.getString("JFileChooserExistsAware.existingFileTitle"), //$NON-NLS-1$
							JOptionPane.YES_NO_CANCEL_OPTION);
					if (answer == JOptionPane.CANCEL_OPTION) {
						cancelSelection();
					}
					if (answer != JOptionPane.YES_OPTION) {
						return;
					}
				}
			}
			super.approveSelection();
		}
	}

	private interface DialogCall {
		List<File> show();
	}

	private static List<File> onEventThread(DialogCall call) {
		if (SwingUtilities.isEventDispatchThread()) {
			return call.show();
		}
		AtomicReference<List<File>> chosen = new AtomicReference<>();
		try {
			SwingUtilities.invokeAndWait(() -> chosen.set(call.show()));
		} catch (InvocationTargetException e) {
			Throwable cause = e.getCause();
			if (cause instanceof RuntimeException) {
				throw (RuntimeException) cause;
			} else if (cause instanceof Error) {
				throw (Error) cause;
			}
			throw new IllegalStateException(cause);
		} catch (InterruptedException e) {
			// The dialog may still be on screen: the user has not cancelled, so the page is not told they did
			Thread.currentThread().interrupt();
			throw new IllegalStateException("Interrupted while the file dialog was open", e);
		}
		return chosen.get();
	}

	/** The icon of the Swing window (CollectEarthWindow), read from the same place; without it, the default one. */
	private void setIcon(JFrame frame) {
		File icon = new File(ICON);
		if (icon.isFile()) {
			frame.setIconImage(new ImageIcon(icon.getPath()).getImage());
		} else {
			logger.debug("No icon for the file dialog at {}", icon.getAbsolutePath()); //$NON-NLS-1$
		}
	}

	private static List<String> clean(List<String> extensions) {
		List<String> clean = new ArrayList<>();
		for (String extension : extensions) {
			String stripped = StringUtils.removeStart(StringUtils.trimToEmpty(extension), ".");
			if (!stripped.isEmpty()) {
				clean.add(stripped);
			}
		}
		return clean;
	}

	/** The filter for the extensions (a leading dot is allowed), or null to show every file. */
	static FileFilter filter(List<String> extensions) {
		List<String> clean = clean(extensions);
		if (clean.isEmpty()) {
			return null;
		}
		StringBuilder description = new StringBuilder();
		for (String extension : clean) {
			description.append(description.length() == 0 ? "" : ", ").append("*.").append(extension);
		}
		return new FileNameExtensionFilter(description.toString(), clean.toArray(new String[0]));
	}

	/**
	 * The file a save writes: the one chosen, with the first extension added unless its name ends with one of them, as
	 * DataFormat.withDefaultExtension does for the Swing interface.
	 */
	static File withExtension(File file, List<String> extensions) {
		List<String> clean = clean(extensions);
		if (clean.isEmpty()) {
			return file;
		}
		String name = file.getName().toLowerCase(Locale.ENGLISH);
		for (String extension : clean) {
			if (name.endsWith("." + extension.toLowerCase(Locale.ENGLISH))) {
				return file;
			}
		}
		return new File(file.getPath() + "." + clean.get(0));
	}

	/**
	 * Where the dialog starts: a folder to open, or a file to preselect. The suggestion when it is a folder or a file in
	 * a folder that exists; a name alone goes in the last folder used, or the default one. Without a suggestion, the last
	 * folder used if it still exists, else null for the dialog's own default.
	 */
	static File start(String suggested, String lastUsedFolder, File defaultFolder) {
		File lastFolder = StringUtils.isBlank(lastUsedFolder) ? null : new File(lastUsedFolder);
		if (lastFolder != null && !lastFolder.isDirectory()) {
			lastFolder = null;
		}
		if (StringUtils.isBlank(suggested)) {
			return lastFolder;
		}
		File file = new File(suggested);
		if (file.isDirectory()) {
			return file;
		}
		File parent = file.getParentFile();
		if (parent == null) {
			return new File(lastFolder != null ? lastFolder : defaultFolder, file.getName());
		}
		return parent.isDirectory() ? file : lastFolder;
	}
}

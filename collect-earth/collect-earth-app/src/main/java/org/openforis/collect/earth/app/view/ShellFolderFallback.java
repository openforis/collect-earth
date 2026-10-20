package org.openforis.collect.earth.app.view;

import java.awt.Window;
import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.function.ToIntFunction;

import javax.swing.JDialog;
import javax.swing.JFileChooser;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Keeps the file choosers working when the Windows shell folders make them fail.
 *
 * On Windows a JFileChooser lists files through the shell (sun.awt.shell.Win32ShellFolder2), and a broken shortcut - a .lnk in
 * the Recent folder whose target is gone - makes it throw InternalError "Unable to bind ... to parent"
 * (JAVA-COLLECT-EARTH-3TB, reported 273 times since 2023). The error can come out of showOpenDialog itself or, more often, out
 * of an event handled while the dialog is open - painting the list of files, opening a folder - in which case it reaches the
 * uncaught exception handler and the dialog stays open without working.
 *
 * When either happens, the file choosers stop using the shell folders for the rest of the session. A chooser that failed while
 * being shown is shown again, and one that failed while open is rebuilt in place. Only the first failure of a session is still
 * reported, so that Sentry says whether this fallback is being used.
 */
public final class ShellFolderFallback {

	private static final Logger logger = LoggerFactory.getLogger(ShellFolderFallback.class);

	static final String USE_SHELL_FOLDER = "FileChooser.useShellFolder"; //$NON-NLS-1$
	/** Read by FlatLaf when it builds the chooser : without the shortcuts bar it does not ask the shell for its folders */
	static final String NO_PLACES_BAR = "FileChooser.noPlacesBar"; //$NON-NLS-1$

	private static volatile boolean shellFoldersDisabled = false;

	/** The choosers being shown, to rebuild them when the failure happens while they are open */
	private static final Set<JFileChooser> openChoosers = Collections.synchronizedSet(Collections.newSetFromMap(new WeakHashMap<>()));

	private ShellFolderFallback() {
	}

	/**
	 * Shows the chooser with the given call - showOpenDialog, showSaveDialog - and shows it once more without the shell folders
	 * if they make it fail.
	 */
	public static int showDialog(JFileChooser chooser, ToIntFunction<JFileChooser> show) {
		if (shellFoldersDisabled) {
			disableShellFolders(chooser);
		}
		openChoosers.add(chooser);
		try {
			return show.applyAsInt(chooser);
		} catch (Error e) {
			if (!isShellFolderFailure(e) || usesPlainFileSystem(chooser)) {
				throw e;
			}
			disableForSession(e);
			// The dialog of the failed attempt may already exist; the next call creates its own
			Window failedDialog = SwingUtilities.getWindowAncestor(chooser);
			if (failedDialog instanceof JDialog) {
				failedDialog.dispose();
			}
			disableShellFolders(chooser);
			return show.applyAsInt(chooser);
		} finally {
			openChoosers.remove(chooser);
		}
	}

	/**
	 * Wraps the current default uncaught exception handler - Sentry's, so this has to run after Sentry is initialised - so that a
	 * shell folder failure in an open file chooser switches the choosers to the fallback.
	 */
	public static void installUncaughtExceptionHandler() {
		final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
		Thread.setDefaultUncaughtExceptionHandler((thread, e) -> {
			if (!onUncaughtException(e)) {
				return;
			}
			if (previous != null) {
				previous.uncaughtException(thread, e);
			} else {
				// What the thread group prints when there is no handler at all
				System.err.print("Exception in thread \"" + thread.getName() + "\" "); //$NON-NLS-1$ //$NON-NLS-2$
				e.printStackTrace(System.err);
			}
		});
	}

	/**
	 * @return whether the failure should still be reported : every failure that is not a shell folder one, and the first shell
	 *         folder one of the session
	 */
	static boolean onUncaughtException(Throwable e) {
		if (!isShellFolderFailure(e)) {
			return true;
		}
		boolean firstTime = disableForSession(e);
		List<JFileChooser> open;
		synchronized (openChoosers) {
			open = new ArrayList<>(openChoosers);
		}
		SwingUtilities.invokeLater(() -> {
			for (JFileChooser chooser : open) {
				if (!usesPlainFileSystem(chooser)) {
					disableShellFolders(chooser);
				}
			}
		});
		return firstTime;
	}

	/**
	 * Did the Windows shell folders throw this? The error is created on the thread that talks to the shell, so its own stack trace
	 * is made of sun.awt.shell frames, whichever thread it is rethrown in.
	 */
	static boolean isShellFolderFailure(Throwable failure) {
		for (Throwable t = failure; t != null; t = t.getCause()) {
			if (t instanceof InternalError) {
				for (StackTraceElement frame : t.getStackTrace()) {
					if (frame.getClassName().startsWith("sun.awt.shell.")) { //$NON-NLS-1$
						return true;
					}
				}
			}
		}
		return false;
	}

	/** @return true the first time */
	private static boolean disableForSession(Throwable cause) {
		if (shellFoldersDisabled) {
			logger.debug("The Windows shell folders failed again, they are already disabled : {}", cause.getMessage()); //$NON-NLS-1$
			return false;
		}
		shellFoldersDisabled = true;
		logger.warn("The Windows shell folders made a file chooser fail, the file choosers will not use them until Collect Earth is restarted : {}", //$NON-NLS-1$
				cause.getMessage());
		return true;
	}

	static boolean usesPlainFileSystem(JFileChooser chooser) {
		return chooser.getFileSystemView() == PlainFileSystemView.INSTANCE;
	}

	static void disableShellFolders(JFileChooser chooser) {
		UIManager.put(NO_PLACES_BAR, Boolean.TRUE);
		chooser.putClientProperty(USE_SHELL_FOLDER, Boolean.FALSE);

		// The current folder may be one of the shell's own objects, or a virtual folder such as "Recent" or "This PC" that is not a
		// folder on disk at all
		File current = chooser.getCurrentDirectory();
		File plainCurrent = current == null ? null : new File(current.getPath());

		chooser.setFileSystemView(PlainFileSystemView.INSTANCE);
		chooser.updateUI();
		chooser.setCurrentDirectory(plainCurrent != null && plainCurrent.isDirectory() ? plainCurrent
				: PlainFileSystemView.INSTANCE.getDefaultDirectory());
	}

	/** For the tests : back to the state of a new session */
	static void reset() {
		shellFoldersDisabled = false;
		openChoosers.clear();
		UIManager.put(NO_PLACES_BAR, null);
	}
}

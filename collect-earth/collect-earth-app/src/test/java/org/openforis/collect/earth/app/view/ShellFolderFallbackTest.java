package org.openforis.collect.earth.app.view;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.awt.Component;
import java.awt.Container;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import javax.swing.JFileChooser;
import javax.swing.LookAndFeel;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;
import javax.swing.filechooser.FileSystemView;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.formdev.flatlaf.FlatLightLaf;

class ShellFolderFallbackTest {

	@BeforeEach
	@AfterEach
	void newSession() {
		ShellFolderFallback.reset();
	}

	/** What the Windows shell throws for a broken shortcut (JAVA-COLLECT-EARTH-3TB) : its frames are the shell's own */
	private static InternalError shellFolderError() {
		InternalError e = new InternalError("Unable to bind C:\\Users\\someone\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\broken.lnk to parent");
		e.setStackTrace(new StackTraceElement[] {
				new StackTraceElement("sun.awt.shell.Win32ShellFolder2$4", "call", "Win32ShellFolder2.java", 0),
				new StackTraceElement("sun.awt.shell.Win32ShellFolderManager2$ComInvoker$1", "run", "Win32ShellFolderManager2.java", 0),
				new StackTraceElement("java.lang.Thread", "run", "Thread.java", 0) });
		return e;
	}

	@Test
	void aChooserThatTheShellMakesFailIsShownAgainWithoutIt() {
		JFileChooser chooser = new JFileChooser();
		List<FileSystemView> viewsShown = new ArrayList<>();

		int result = ShellFolderFallback.showDialog(chooser, c -> {
			viewsShown.add(c.getFileSystemView());
			if (viewsShown.size() == 1) {
				throw shellFolderError();
			}
			return JFileChooser.APPROVE_OPTION;
		});

		assertEquals(JFileChooser.APPROVE_OPTION, result);
		assertEquals(2, viewsShown.size());
		assertNotSame(PlainFileSystemView.INSTANCE, viewsShown.get(0));
		assertSame(PlainFileSystemView.INSTANCE, viewsShown.get(1));
		assertEquals(Boolean.FALSE, chooser.getClientProperty(ShellFolderFallback.USE_SHELL_FOLDER));
		assertTrue(UIManager.getBoolean(ShellFolderFallback.NO_PLACES_BAR), "FlatLaf would still build its shortcuts bar from the shell");
	}

	@Test
	void afterAFailureTheNextChoosersDoNotUseTheShellFromTheStart() {
		ShellFolderFallback.showDialog(new JFileChooser(), c -> {
			if (!ShellFolderFallback.usesPlainFileSystem(c)) {
				throw shellFolderError();
			}
			return JFileChooser.CANCEL_OPTION;
		});

		List<FileSystemView> viewsShown = new ArrayList<>();
		ShellFolderFallback.showDialog(new JFileChooser(), c -> {
			viewsShown.add(c.getFileSystemView());
			return JFileChooser.CANCEL_OPTION;
		});

		assertEquals(1, viewsShown.size());
		assertSame(PlainFileSystemView.INSTANCE, viewsShown.get(0));
	}

	@Test
	void aChooserThatFailsEvenWithoutTheShellIsNotShownAThirdTime() {
		AtomicInteger attempts = new AtomicInteger();

		assertThrows(InternalError.class, () -> ShellFolderFallback.showDialog(new JFileChooser(), c -> {
			attempts.incrementAndGet();
			throw shellFolderError();
		}));

		assertEquals(2, attempts.get());
	}

	@Test
	void otherErrorsAreNotRetried() {
		AtomicInteger attempts = new AtomicInteger();
		JFileChooser chooser = new JFileChooser();

		assertThrows(InternalError.class, () -> ShellFolderFallback.showDialog(chooser, c -> {
			attempts.incrementAndGet();
			throw new InternalError("not from the shell");
		}));

		assertEquals(1, attempts.get());
		assertFalse(ShellFolderFallback.usesPlainFileSystem(chooser));
	}

	// The common case in the field : the failure happens in an event handled while the dialog is open, and reaches the uncaught
	// exception handler instead of the caller of showOpenDialog
	@Test
	void aFailureWhileAChooserIsOpenRebuildsItWithoutTheShell() throws Exception {
		JFileChooser chooser = new JFileChooser();

		ShellFolderFallback.showDialog(chooser, c -> {
			ShellFolderFallback.onUncaughtException(shellFolderError());
			return JFileChooser.CANCEL_OPTION;
		});
		// The chooser is rebuilt on the event thread
		SwingUtilities.invokeAndWait(() -> {});

		assertSame(PlainFileSystemView.INSTANCE, chooser.getFileSystemView());
		assertTrue(chooser.getCurrentDirectory().isDirectory(), "The current folder has to be a real one");
	}

	@Test
	void onlyTheFirstShellFailureOfASessionIsReported() {
		assertTrue(ShellFolderFallback.onUncaughtException(shellFolderError()));
		assertFalse(ShellFolderFallback.onUncaughtException(shellFolderError()));
		assertTrue(ShellFolderFallback.onUncaughtException(new IllegalStateException("anything else")));
	}

	@Test
	void theHandlerPassesOtherFailuresToTheOneItWraps() {
		Thread.UncaughtExceptionHandler original = Thread.getDefaultUncaughtExceptionHandler();
		List<Throwable> reported = new ArrayList<>();
		try {
			Thread.setDefaultUncaughtExceptionHandler((thread, e) -> reported.add(e));
			ShellFolderFallback.installUncaughtExceptionHandler();
			Thread.UncaughtExceptionHandler handler = Thread.getDefaultUncaughtExceptionHandler();

			InternalError first = shellFolderError();
			IllegalStateException other = new IllegalStateException("anything else");
			handler.uncaughtException(Thread.currentThread(), first);
			handler.uncaughtException(Thread.currentThread(), shellFolderError());
			handler.uncaughtException(Thread.currentThread(), other);

			assertEquals(2, reported.size(), "The repeated shell failure should not have been reported");
			assertSame(first, reported.get(0));
			assertSame(other, reported.get(1));
		} finally {
			Thread.setDefaultUncaughtExceptionHandler(original);
		}
	}

	private static boolean containsShortcutsBar(Container container) {
		for (Component component : container.getComponents()) {
			if (component.getClass().getName().endsWith("FlatShortcutsPanel")
					|| (component instanceof Container && containsShortcutsBar((Container) component))) {
				return true;
			}
		}
		return false;
	}

	// FlatLaf, the look and feel of Collect Earth, builds a bar of shortcuts that it gets from the shell
	@Test
	void withFlatLafTheFallbackRemovesTheShortcutsBar() throws Exception {
		LookAndFeel original = UIManager.getLookAndFeel();
		try {
			UIManager.setLookAndFeel(new FlatLightLaf());
			JFileChooser chooser = new JFileChooser();
			// There is a bar only where the system has shortcuts to offer, as Windows does
			assumeTrue(containsShortcutsBar(chooser), "No shortcuts bar on this system");

			ShellFolderFallback.disableShellFolders(chooser);

			assertFalse(containsShortcutsBar(chooser));
		} finally {
			UIManager.setLookAndFeel(original);
		}
	}

	@Test
	void onlyInternalErrorsFromTheShellAreShellFailures() {
		assertTrue(ShellFolderFallback.isShellFolderFailure(shellFolderError()));
		assertTrue(ShellFolderFallback.isShellFolderFailure(new RuntimeException("wrapped", shellFolderError())));
		assertFalse(ShellFolderFallback.isShellFolderFailure(new InternalError("not from the shell")));

		RuntimeException sameFramesOtherType = new RuntimeException("not an InternalError");
		sameFramesOtherType.setStackTrace(shellFolderError().getStackTrace());
		assertFalse(ShellFolderFallback.isShellFolderFailure(sameFramesOtherType));
	}
}

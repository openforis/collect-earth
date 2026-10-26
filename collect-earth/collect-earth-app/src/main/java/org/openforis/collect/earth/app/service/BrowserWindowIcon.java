package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.sun.jna.Native;
import com.sun.jna.Platform;
import com.sun.jna.Pointer;
import com.sun.jna.WString;
import com.sun.jna.ptr.IntByReference;
import com.sun.jna.win32.StdCallLibrary;

/**
 * Gives the windows of a browser started by Collect Earth an icon of their own on the Windows task bar.
 * <p>
 * The plots map is an app window, which Chrome and Edge show with the icon of its page. The imagery window is a normal
 * one, with tabs, and showed the icon of the browser, so it could not be told from the interpreter's own browser.
 * Windows takes the task bar icon of a window from the window itself, and another process may set it, so it is set
 * here on every top-level window of the browser's processes. The browser keeps it: it does not set its icon again.
 * <p>
 * The browser's processes are the ones Collect Earth started while starting it: they descend from this one, through
 * the driver, and were not there before ({@link #processes()} then {@link #apply(Set)}). Nothing happens elsewhere
 * than on Windows, and a failure only leaves the browser's icon.
 */
final class BrowserWindowIcon {

	private static final Logger logger = LoggerFactory.getLogger(BrowserWindowIcon.class);

	private static final int WM_SETICON = 0x0080;
	private static final int ICON_SMALL = 0;
	private static final int ICON_BIG = 1;
	private static final int IMAGE_ICON = 1;
	private static final int LR_LOADFROMFILE = 0x0010;
	private static final int SM_CXICON = 11;
	private static final int SM_CXSMICON = 49;
	private static final int GW_OWNER = 4;

	private final String resource;
	/** The icon written to a file once, which is what LoadImage reads; null until then, or when it cannot be. */
	private File iconFile;
	private Pointer bigIcon;
	private Pointer smallIcon;
	/** The processes of the browser given the icon last, for the windows it opens later: see {@link #applyAgain()}. */
	private Set<Long> browserProcesses = new HashSet<>();

	/** @param resource the class path of the .ico file, with the sizes the task bar takes (16 to 64 pixels) */
	BrowserWindowIcon(String resource) {
		this.resource = resource;
	}

	/** The processes descending from this one, to tell the ones of a browser started after this call. */
	static Set<Long> processes() {
		if (!Platform.isWindows()) {
			return new HashSet<>();
		}
		return ProcessHandle.current().descendants().map(ProcessHandle::pid).collect(Collectors.toSet());
	}

	/**
	 * Sets the icon on the visible top-level windows of the processes started since {@code before}.
	 *
	 * @return how many windows got it
	 */
	synchronized int apply(Set<Long> before) {
		if (!Platform.isWindows()) {
			return 0;
		}
		try {
			Set<Long> started = processes();
			started.removeAll(before);
			browserProcesses = started;
			return applyTo(started);
		} catch (RuntimeException | LinkageError e) {
			logger.warn("Could not set the icon of the browser windows from {}", resource, e);
			return 0;
		}
	}

	/**
	 * Sets the icon again on the windows of the browser of the last {@link #apply(Set)}: those it opened since, which
	 * Windows shows with the browser's icon, get it too. The windows that have it keep it.
	 *
	 * @return how many windows got it
	 */
	synchronized int applyAgain() {
		if (!Platform.isWindows()) {
			return 0;
		}
		try {
			return applyTo(browserProcesses);
		} catch (RuntimeException | LinkageError e) {
			logger.warn("Could not set the icon of the browser windows from {}", resource, e);
			return 0;
		}
	}

	/** Sets the icon on the visible top-level windows of these processes. */
	private int applyTo(Set<Long> processes) {
		if (processes.isEmpty() || !loadIcons()) {
			return 0;
		}
		int[] count = { 0 };
		User32.INSTANCE.EnumWindows((window, data) -> {
			IntByReference pid = new IntByReference();
			User32.INSTANCE.GetWindowThreadProcessId(window, pid);
			if (processes.contains((long) pid.getValue()) && User32.INSTANCE.IsWindowVisible(window)
					&& User32.INSTANCE.GetWindow(window, GW_OWNER) == null) {
				User32.INSTANCE.SendMessageW(window, WM_SETICON, new Pointer(ICON_BIG), bigIcon);
				User32.INSTANCE.SendMessageW(window, WM_SETICON, new Pointer(ICON_SMALL), smallIcon);
				count[0]++;
			}
			return true;
		}, null);
		return count[0];
	}

	/** The icons at the sizes of the task bar for this screen, loaded once; false when they cannot be. */
	private boolean loadIcons() {
		if (bigIcon != null && smallIcon != null) {
			return true;
		}
		if (iconFile == null) {
			try (InputStream in = BrowserWindowIcon.class.getResourceAsStream(resource)) {
				if (in == null) {
					logger.warn("The icon {} is not in the class path", resource);
					return false;
				}
				File file = File.createTempFile("collect-earth-window-icon", ".ico");
				file.deleteOnExit();
				Files.copy(in, file.toPath(), StandardCopyOption.REPLACE_EXISTING);
				iconFile = file;
			} catch (IOException e) {
				logger.warn("Could not write the icon {} to a file", resource, e);
				return false;
			}
		}
		// The sizes of this screen's scale: Java is DPI aware, so they are the scaled ones
		int big = User32.INSTANCE.GetSystemMetrics(SM_CXICON);
		int small = User32.INSTANCE.GetSystemMetrics(SM_CXSMICON);
		WString path = new WString(iconFile.getAbsolutePath());
		bigIcon = User32.INSTANCE.LoadImageW(null, path, IMAGE_ICON, big, big, LR_LOADFROMFILE);
		smallIcon = User32.INSTANCE.LoadImageW(null, path, IMAGE_ICON, small, small, LR_LOADFROMFILE);
		return bigIcon != null && smallIcon != null;
	}

	/** The few functions of user32.dll used here, which JNA alone (without jna-platform) can call. */
	private interface User32 extends StdCallLibrary {

		User32 INSTANCE = Native.load("user32", User32.class);

		interface EnumWindowsProc extends StdCallCallback {
			boolean callback(Pointer window, Pointer data);
		}

		boolean EnumWindows(EnumWindowsProc callback, Pointer data);

		int GetWindowThreadProcessId(Pointer window, IntByReference processId);

		boolean IsWindowVisible(Pointer window);

		Pointer GetWindow(Pointer window, int command);

		Pointer SendMessageW(Pointer window, int message, Pointer wParam, Pointer lParam);

		Pointer LoadImageW(Pointer instance, WString name, int type, int width, int height, int load);

		int GetSystemMetrics(int index);
	}
}

package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
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
 * A window whose title starts with {@code titlePrefix} gets the other icon: the window of Google Earth Web with the
 * plots map in its panel, which names its page so (javascript_plots_map_panel.fmt), apart from the window of the other
 * imagery. A window's title is the one of its tab shown, so the icon is set again when the titles may have changed
 * ({@link #applyAgain()}).
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
	private static final int MAX_TITLE = 256;

	private final String resource;
	private final String titlePrefix;
	private final String titledResource;
	/** The icons loaded, {big, small} by resource; a resource missing when they cannot be. */
	private final Map<String, Pointer[]> icons = new HashMap<>();
	/** The processes of the browser given the icon last, for the windows it opens later: see {@link #applyAgain()}. */
	private Set<Long> browserProcesses = new HashSet<>();

	/** @param resource the class path of the .ico file, with the sizes the task bar takes (16 to 64 pixels) */
	BrowserWindowIcon(String resource) {
		this(resource, null, null);
	}

	/**
	 * @param titlePrefix    how the title of the windows that get {@code titledResource} instead starts; null for none
	 * @param titledResource the class path of their .ico file
	 */
	BrowserWindowIcon(String resource, String titlePrefix, String titledResource) {
		this.resource = resource;
		this.titlePrefix = titlePrefix;
		this.titledResource = titledResource;
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
	 * Windows shows with the browser's icon, get it too, and each window the icon of its title now.
	 *
	 * @return how many windows got an icon
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

	/** Sets the icons on the visible top-level windows of these processes. */
	private int applyTo(Set<Long> processes) {
		Pointer[] plain = processes.isEmpty() ? null : load(resource);
		if (plain == null) {
			return 0;
		}
		Pointer[] titled = titlePrefix == null ? null : load(titledResource);
		int[] count = { 0 };
		User32.INSTANCE.EnumWindows((window, data) -> {
			IntByReference pid = new IntByReference();
			User32.INSTANCE.GetWindowThreadProcessId(window, pid);
			if (processes.contains((long) pid.getValue()) && User32.INSTANCE.IsWindowVisible(window)
					&& User32.INSTANCE.GetWindow(window, GW_OWNER) == null) {
				Pointer[] icon = titled != null && titleOf(window).startsWith(titlePrefix) ? titled : plain;
				User32.INSTANCE.SendMessageW(window, WM_SETICON, new Pointer(ICON_BIG), icon[0]);
				User32.INSTANCE.SendMessageW(window, WM_SETICON, new Pointer(ICON_SMALL), icon[1]);
				count[0]++;
			}
			return true;
		}, null);
		return count[0];
	}

	private static String titleOf(Pointer window) {
		char[] title = new char[MAX_TITLE];
		int length = User32.INSTANCE.GetWindowTextW(window, title, MAX_TITLE);
		return length <= 0 ? "" : new String(title, 0, length);
	}

	/**
	 * The icons of the resource at the sizes of the task bar for this screen, {big, small}, loaded once; null when they
	 * cannot be. LoadImage reads them from a file, so the resource is written to one first.
	 */
	private Pointer[] load(String iconResource) {
		Pointer[] loaded = icons.get(iconResource);
		if (loaded != null) {
			return loaded;
		}
		File file;
		try (InputStream in = BrowserWindowIcon.class.getResourceAsStream(iconResource)) {
			if (in == null) {
				logger.warn("The icon {} is not in the class path", iconResource);
				return null;
			}
			file = File.createTempFile("collect-earth-window-icon", ".ico");
			file.deleteOnExit();
			Files.copy(in, file.toPath(), StandardCopyOption.REPLACE_EXISTING);
		} catch (IOException e) {
			logger.warn("Could not write the icon {} to a file", iconResource, e);
			return null;
		}
		// The sizes of this screen's scale: Java is DPI aware, so they are the scaled ones
		int big = User32.INSTANCE.GetSystemMetrics(SM_CXICON);
		int small = User32.INSTANCE.GetSystemMetrics(SM_CXSMICON);
		WString path = new WString(file.getAbsolutePath());
		Pointer bigIcon = User32.INSTANCE.LoadImageW(null, path, IMAGE_ICON, big, big, LR_LOADFROMFILE);
		Pointer smallIcon = User32.INSTANCE.LoadImageW(null, path, IMAGE_ICON, small, small, LR_LOADFROMFILE);
		if (bigIcon == null || smallIcon == null) {
			return null;
		}
		loaded = new Pointer[] { bigIcon, smallIcon };
		icons.put(iconResource, loaded);
		return loaded;
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

		int GetWindowTextW(Pointer window, char[] text, int maxCount);

		Pointer SendMessageW(Pointer window, int message, Pointer wParam, Pointer lParam);

		Pointer LoadImageW(Pointer instance, WString name, int type, int width, int height, int load);

		int GetSystemMetrics(int index);
	}
}

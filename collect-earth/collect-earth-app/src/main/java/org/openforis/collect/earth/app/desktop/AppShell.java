package org.openforis.collect.earth.app.desktop;

import java.awt.GraphicsEnvironment;
import java.awt.Image;
import java.awt.MenuItem;
import java.awt.PopupMenu;
import java.awt.SystemTray;
import java.awt.Toolkit;
import java.awt.TrayIcon;

import org.openforis.collect.earth.app.service.BrowserService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.QuitService;
import org.openforis.collect.earth.app.service.WindowLayoutService;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

/**
 * What is left of the Swing main window (CollectEarthWindow): the pages of the app are the main window now, the plots
 * map or, with the Google Earth Pro viewer, the home page ({@link BrowserService#openHomePage()}). A browser window
 * can be closed, and then nothing on the screen says that Collect Earth still runs, so an icon in the system tray
 * opens it again or quits it.
 * <p>
 * Created again with the Spring context, which the server restart creates anew (project, settings or language
 * changed): the icon is taken out when the context closes, otherwise each context would leave one more in the tray.
 */
// Not lazy: the application context creates its beans lazily (applicationContext.fmt), and nothing asks for this one
@Component
@Lazy(false)
public class AppShell implements InitializingBean, DisposableBean {

	private static final String ICON_FILE = "images/smallOpenForisBanner.png"; //$NON-NLS-1$

	private final Logger logger = LoggerFactory.getLogger(AppShell.class);

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private BrowserService browserService;

	@Autowired
	private WindowLayoutService windowLayoutService;

	@Autowired
	private QuitService quitService;

	private TrayIcon trayIcon;

	public AppShell() {
		// For Spring
	}

	/** For the tests. */
	AppShell(LocalPropertiesService localPropertiesService, BrowserService browserService,
			WindowLayoutService windowLayoutService, QuitService quitService) {
		this.localPropertiesService = localPropertiesService;
		this.browserService = browserService;
		this.windowLayoutService = windowLayoutService;
		this.quitService = quitService;
	}

	@Override
	public void afterPropertiesSet() {
		// The Swing window did this first: the texts of the dialogs that still are Swing, and of the tray menu, are in
		// the UI language of the settings, which may have changed since the previous context
		Messages.setLocale(localPropertiesService.getUiLanguage().getLocale());
		if (GraphicsEnvironment.isHeadless() || !SystemTray.isSupported()) {
			logger.info("No system tray: Collect Earth has no icon to open its window again or to quit"); //$NON-NLS-1$
			return;
		}
		try {
			addTrayIcon();
		} catch (Exception e) {
			// Collect Earth works without the icon: the pages can quit it, and the window can be opened again by
			// starting Collect Earth again
			logger.error("The icon of Collect Earth could not be added to the system tray", e); //$NON-NLS-1$
		}
	}

	private void addTrayIcon() throws java.awt.AWTException {
		PopupMenu menu = new PopupMenu();
		MenuItem open = new MenuItem(Messages.getString("AppShell.open")); //$NON-NLS-1$
		open.addActionListener(e -> openInBackground());
		menu.add(open);
		menu.addSeparator();
		MenuItem quit = new MenuItem(Messages.getString("CollectEarthWindow.42")); //$NON-NLS-1$
		// QuitService does its work on a thread of its own and returns at once
		quit.addActionListener(e -> quitService.run());
		menu.add(quit);

		Image image = Toolkit.getDefaultToolkit().getImage(ICON_FILE);
		TrayIcon icon = new TrayIcon(image, "Collect Earth", menu); //$NON-NLS-1$
		icon.setImageAutoSize(true);
		// The double click on the icon (or Enter on it), which users expect to bring the window back
		icon.addActionListener(e -> openInBackground());
		SystemTray.getSystemTray().add(icon);
		trayIcon = icon;
	}

	/**
	 * Opens the main window, on a thread of its own: the listeners of the icon run on the AWT event thread, and a browser
	 * takes seconds to start or to answer, which would freeze the tray menu and every Swing dialog meanwhile.
	 */
	private void openInBackground() {
		Thread thread = new Thread(() -> {
			try {
				open();
			} catch (Exception e) {
				logger.error("Collect Earth's window could not be opened from the tray icon", e); //$NON-NLS-1$
			}
		}, "Open Collect Earth from the tray"); //$NON-NLS-1$
		thread.setDaemon(true);
		thread.start();
	}

	/**
	 * What "Open Collect Earth" does, as the viewer is now (it can change without a new context). With the plots map as
	 * the viewer, the plots map window: opened if it never was; otherwise put back and brought in front of the others,
	 * opened again first if the user closed it, as "Arrange" does. Not loaded again when it is open, as opening the plots
	 * map would: it holds the form, which would lose what the user typed in it. With the Google Earth Pro viewer, the
	 * home page, which holds no form.
	 */
	void open() {
		if (!localPropertiesService.isPlotsMapViewer()) {
			browserService.openHomePage();
		} else if (browserService.getLeafletMapDriver() == null) {
			browserService.openLeafletMap();
			windowLayoutService.arrange();
		} else {
			windowLayoutService.arrangeAndBringForward();
		}
	}

	@Override
	public void destroy() {
		if (trayIcon != null) {
			SystemTray.getSystemTray().remove(trayIcon);
			trayIcon = null;
		}
	}
}

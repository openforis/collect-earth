package org.openforis.collect.earth.app.desktop;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.BrowserService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.QuitService;
import org.openforis.collect.earth.app.service.WindowLayoutService;
import org.openqa.selenium.remote.RemoteWebDriver;

/** What "Open Collect Earth" of the tray icon opens; the icon itself needs a display. */
public class AppShellTest {

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final BrowserService browser = mock(BrowserService.class);
	private final WindowLayoutService layout = mock(WindowLayoutService.class);
	private final AppShell shell = new AppShell(properties, browser, layout, mock(QuitService.class));

	@Test
	public void withGoogleEarthProTheHomePageOpens() {
		when(properties.isPlotsMapViewer()).thenReturn(false);
		shell.open();
		verify(browser).openHomePage();
		verify(browser, never()).openLeafletMap();
		verify(layout, never()).arrangeAndBringForward();
	}

	@Test
	public void withThePlotsMapNeverOpenedThePlotsMapOpens() {
		when(properties.isPlotsMapViewer()).thenReturn(true);
		shell.open();
		verify(browser).openLeafletMap();
		verify(layout).arrange();
		verify(browser, never()).openHomePage();
	}

	@Test
	public void withThePlotsMapOpenedOnceItIsBroughtBackWithoutReloadingTheForm() {
		when(properties.isPlotsMapViewer()).thenReturn(true);
		when(browser.getLeafletMapDriver()).thenReturn(mock(RemoteWebDriver.class));
		shell.open();
		// arrangeAndBringForward reopens it if the user closed it, and leaves the form alone if not
		verify(layout).arrangeAndBringForward();
		verify(browser, never()).openLeafletMap();
		verify(browser, never()).openHomePage();
	}
}

package org.openforis.collect.earth.app.desktop;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.QuitService;
import org.openforis.collect.earth.app.service.WindowLayoutService;

/** What "Open Collect Earth" of the tray icon opens; the icon itself needs a display. */
public class AppShellTest {

	private final WindowLayoutService layout = mock(WindowLayoutService.class);
	private final AppShell shell = new AppShell(mock(LocalPropertiesService.class), layout, mock(QuitService.class));

	@Test
	public void theWindowsAreBroughtBackWithoutReloadingTheForm() {
		shell.open();
		// arrangeAndBringForward opens Google Earth Web if it is not open, and leaves the form alone if it is
		verify(layout).arrangeAndBringForward();
	}
}

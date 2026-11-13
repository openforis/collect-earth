package org.openforis.collect.earth.app.server;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** Only another Collect Earth on this computer, not a page in a browser, is taken for one. */
public class LocalClientsTest {

	private static MockHttpServletRequest from(String address) {
		MockHttpServletRequest request = new MockHttpServletRequest();
		request.setRemoteAddr(address);
		return request;
	}

	@Test
	public void aLoopbackRequestWithoutBrowserHeadersIsAnotherCollectEarth() {
		assertTrue(LocalClients.isOtherCollectEarth(from("127.0.0.1")));
	}

	@Test
	public void aBrowserOrAnotherComputerIsRefused() {
		MockHttpServletRequest page = from("127.0.0.1");
		page.addHeader("Referer", "https://example.com/");
		assertFalse(LocalClients.isOtherCollectEarth(page));
		assertFalse(LocalClients.isOtherCollectEarth(from("192.168.1.20")));
	}
}

package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.notices.NoticeService;

/** A sign-in the server no longer takes (unused for months, or signed out by a coordinator): the login is asked again. */
public class CloudSyncSignedOutTest {

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final NoticeService notices = new NoticeService();
	private final CloudSyncService sync = new CloudSyncService();

	private void inject(String name, Object value) throws Exception {
		Field field = CloudSyncService.class.getDeclaredField(name);
		field.setAccessible(true);
		field.set(sync, value);
	}

	@Test
	public void onlyARefusedSignInCounts() {
		assertTrue(CloudSyncService.isSignInRefused(new IOException("records batch failed: HTTP 401 {\"error\":\"unauthorized\"}")));
		assertFalse(CloudSyncService.isSignInRefused(new IOException("records batch failed: HTTP 503")));
		assertFalse(CloudSyncService.isSignInRefused(new IOException("Connection refused")));
		assertFalse(CloudSyncService.isSignInRefused(new IOException((String) null)));
	}

	@Test
	public void theTokenIsForgottenAndThePersonToldOnce() throws Exception {
		inject("localPropertiesService", properties);
		inject("notices", notices);
		when(properties.getCloudSyncToken()).thenReturn("old-token");
		sync.signedOut();
		sync.signedOut();
		verify(properties, org.mockito.Mockito.times(2)).saveCloudSyncToken("");
		List<Map<String, Object>> pending = notices.pending();
		assertEquals(1, pending.size());
		assertEquals(CloudSyncService.SIGNED_OUT_NOTICE, pending.get(0).get("kind"));
	}

	@Test
	public void noTokenNothingToForget() throws Exception {
		inject("localPropertiesService", properties);
		inject("notices", notices);
		when(properties.getCloudSyncToken()).thenReturn("");
		sync.signedOut();
		verify(properties, never()).saveCloudSyncToken("");
		assertTrue(notices.pending().isEmpty());
	}
}

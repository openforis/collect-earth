package org.openforis.collect.earth.app.service.notices;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.LocalPropertiesService;

public class UpdateServiceTest {

	private final NoticeService notices = new NoticeService();
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final List<URI> opened = new ArrayList<>();
	private boolean warn = true;

	private final UpdateService.Check check = new UpdateService.Check() {
		@Override
		public boolean shouldWarnUser(LocalPropertiesService p) {
			return warn;
		}

		@Override
		public String versionAvailableOnline() {
			return "202611011200";
		}

		@Override
		public String versionDate(String build) {
			return "2026-11-01";
		}
	};

	@SuppressWarnings("unchecked")
	private static List<Map<String, String>> options(Map<String, Object> notice) {
		return (List<Map<String, String>>) notice.get("options");
	}

	@Test
	public void theOfferHasTheThreeAnswersAndNeverRemembersTheBuild() {
		new UpdateService(notices, properties, check, false, opened::add).offer();
		List<Map<String, Object>> pending = notices.pending();
		assertEquals(1, pending.size());
		assertEquals("update", pending.get(0).get("kind"));
		assertEquals("Update alert - Version 2026-11-01", pending.get(0).get("title"));
		assertEquals(List.of("later", "now", "never"), List.of(options(pending.get(0)).get(0).get("id"), options(pending.get(0)).get(1).get("id"), options(pending.get(0)).get(2).get("id")));
		notices.answer((String) pending.get(0).get("id"), "never");
		verify(properties).setValue(EarthProperty.LAST_IGNORED_UPDATE, "202611011200");
	}

	@Test
	public void onAMacTheInstallerIsDownloadedInstead() {
		new UpdateService(notices, properties, check, true, opened::add).offer();
		Map<String, Object> notice = notices.pending().get(0);
		assertEquals("download", options(notice).get(1).get("id"));
		notices.answer((String) notice.get("id"), "download");
		assertEquals(1, opened.size());
		assertTrue(opened.get(0).toString().endsWith("e=dmg"));
		verifyNoInteractions(properties);
	}

	@Test
	public void nothingWhenThereIsNothingNewToSay() {
		warn = false;
		new UpdateService(notices, properties, check, false, opened::add).offer();
		assertTrue(notices.pending().isEmpty());
	}

	@org.junit.jupiter.api.io.TempDir
	java.io.File folder;

	@Test
	public void theUpdaterMissingIsSaidWithItsName() {
		UpdateService service = new UpdateService(notices, properties, check, false, opened::add);
		UpdateService.UpdaterMissingException e = org.junit.jupiter.api.Assertions.assertThrows(UpdateService.UpdaterMissingException.class, () -> service.runUpdater(folder));
		assertTrue(e.getMessage().contains("autoupdate"));
	}
}

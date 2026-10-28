package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

public class ApiHeaderFilterTest {

	@Test
	public void onlyRequestsWithTheHeaderPass() {
		assertTrue(ApiHeaderFilter.isAllowed("1"));
		assertFalse(ApiHeaderFilter.isAllowed(null));
		assertFalse(ApiHeaderFilter.isAllowed(""));
		assertFalse(ApiHeaderFilter.isAllowed("0"));
	}
}

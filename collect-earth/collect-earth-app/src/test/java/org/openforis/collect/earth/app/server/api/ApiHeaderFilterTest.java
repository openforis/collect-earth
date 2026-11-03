package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

public class ApiHeaderFilterTest {

	@Test
	public void onlyRequestsWithTheHeaderPass() {
		assertTrue(ApiHeaderFilter.isAllowed("1"));
		assertFalse(ApiHeaderFilter.isAllowed(null));
		assertFalse(ApiHeaderFilter.isAllowed(""));
		assertFalse(ApiHeaderFilter.isAllowed("0"));
	}

	@Test
	public void aRequestWithoutTheHeaderIsForbidden() throws Exception {
		MockHttpServletResponse response = new MockHttpServletResponse();
		MockFilterChain chain = new MockFilterChain();
		new ApiHeaderFilter().doFilter(new MockHttpServletRequest("GET", "/api/projects"), response, chain);
		assertEquals(403, response.getStatus());
		assertNull(chain.getRequest(), "the chain must not be called");
	}

	@Test
	public void aRequestWithTheHeaderGoesOn() throws Exception {
		MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/projects");
		request.addHeader("X-Collect-Earth", "1");
		MockHttpServletResponse response = new MockHttpServletResponse();
		MockFilterChain chain = new MockFilterChain();
		new ApiHeaderFilter().doFilter(request, response, chain);
		assertEquals(200, response.getStatus());
		assertNotNull(chain.getRequest(), "the chain must be called");
	}
}

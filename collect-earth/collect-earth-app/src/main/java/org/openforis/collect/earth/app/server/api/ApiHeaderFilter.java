package org.openforis.collect.earth.app.server.api;

import java.io.IOException;

import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/**
 * Lets through to /api/* only the requests that carry {@code X-Collect-Earth: 1}, as the pages of Collect Earth send
 * (api.ts). A page of another site cannot add that header without a CORS preflight, which the cross-origin filter of
 * web.xml refuses as it allows no such header: with OwnPagesOnlyFilter, mapped before this one, no other page can make
 * Collect Earth export, delete plots or change its settings. A secret token would protect no better, and would have to
 * be handed to the page somehow.
 */
public class ApiHeaderFilter implements Filter {

	static final String HEADER = "X-Collect-Earth";

	static boolean isAllowed(String header) {
		return "1".equals(header);
	}

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
			throws IOException, ServletException {
		if (!isAllowed(((HttpServletRequest) request).getHeader(HEADER))) {
			((HttpServletResponse) response).sendError(HttpServletResponse.SC_FORBIDDEN);
			return;
		}
		chain.doFilter(request, response);
	}
}

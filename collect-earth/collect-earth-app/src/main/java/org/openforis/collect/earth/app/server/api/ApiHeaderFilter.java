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
 * (api.ts). A page of another site cannot send that header without a CORS preflight first: an OPTIONS request that
 * names the header but carries no value for it. On /api/* that preflight is answered 403, by OwnPagesOnlyFilter (its
 * Sec-Fetch-Site and Origin are another site's) and by this filter (no header), both mapped in web.xml before the
 * cross-origin filter, so the browser never sends the request itself. The protection therefore does not depend on the
 * headers the cross-origin filter allows, which lets in http://localhost:* with credentials. A request without the
 * header, which needs no preflight (a form, an image), is refused here. So no other page can make Collect Earth export,
 * delete plots or change its settings. A secret token would protect no better, and would have to be handed to the page
 * somehow.
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

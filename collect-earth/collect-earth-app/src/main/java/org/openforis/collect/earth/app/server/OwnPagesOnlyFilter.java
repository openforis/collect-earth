package org.openforis.collect.earth.app.server;

import java.io.IOException;

import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.FilterConfig;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Lets through to the endpoints that drive the imagery window and Google Earth Web (/googleEarthWeb/*, /imagery/*, see
 * web.xml) only the requests of Collect Earth's own pages: the plots map and its form, served by this server. Those
 * endpoints are GETs that act (show a plot, move the camera, open and arrange windows), and any web page open in a
 * browser on the same computer could otherwise send them, with an image or a fetch, while Collect Earth runs.
 * <p>
 * A request is refused when the browser says it comes from another site ({@code Sec-Fetch-Site: cross-site}, which
 * browsers send on fetches, images and navigations alike), or when it names an origin ({@code Origin}, sent on
 * cross-origin requests and on POSTs) that is not this server's own. A request with neither header is let through: it
 * is not from a page a browser shows (or from a browser too old to say), and the plots map's own requests say
 * {@code same-origin}.
 * <p>
 * Not applied to the endpoints Google Earth Pro's balloons call (/openAuxiliaryWindows, /ancillaryWindows, the save and
 * update endpoints): their callers are not browsers Collect Earth controls, and what they send is not known. Mapped
 * before the other filters in web.xml, as GoogleEarthHeaderFilter answers "*" for a missing Origin.
 */
public class OwnPagesOnlyFilter implements Filter {

	private static final String SEC_FETCH_SITE = "Sec-Fetch-Site";
	private static final String ORIGIN = "Origin";
	private static final String HOST = "Host";

	private final Logger logger = LoggerFactory.getLogger(OwnPagesOnlyFilter.class);

	/**
	 * Whether a request with these headers may come from one of this server's own pages.
	 *
	 * @param secFetchSite the {@code Sec-Fetch-Site} header, or null
	 * @param origin       the {@code Origin} header, or null
	 * @param scheme       the scheme of the request (http)
	 * @param host         the {@code Host} header (host and port, as the browser wrote them), or null
	 */
	static boolean isFromOwnPage(String secFetchSite, String origin, String scheme, String host) {
		if (secFetchSite != null && "cross-site".equalsIgnoreCase(secFetchSite.trim())) {
			return false;
		}
		if (origin == null) {
			return true;
		}
		// "null" (a sandboxed frame, a file) is no origin of ours either
		return host != null && origin.trim().equalsIgnoreCase(scheme + "://" + host.trim());
	}

	@Override
	public void init(FilterConfig filterConfig) {
		// nothing to set up
	}

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
			throws IOException, ServletException {
		HttpServletRequest http = (HttpServletRequest) request;
		if (!isFromOwnPage(http.getHeader(SEC_FETCH_SITE), http.getHeader(ORIGIN), http.getScheme(), http.getHeader(HOST))) {
			logger.warn("Refused {} from another site (Sec-Fetch-Site {}, Origin {})", http.getRequestURI(),
					http.getHeader(SEC_FETCH_SITE), http.getHeader(ORIGIN));
			((HttpServletResponse) response).sendError(HttpServletResponse.SC_FORBIDDEN);
			return;
		}
		chain.doFilter(request, response);
	}

	@Override
	public void destroy() {
		// nothing to release
	}
}

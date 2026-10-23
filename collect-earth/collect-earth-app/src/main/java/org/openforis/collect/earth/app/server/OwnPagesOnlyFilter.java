package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.FilterConfig;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.context.support.WebApplicationContextUtils;

/**
 * Lets through to the endpoints that drive the imagery window and Google Earth Web (/googleEarthWeb/*, /imagery/*, see
 * web.xml) only the requests of Collect Earth's own pages: the plots map and its form, served by this server. Those
 * endpoints are GETs that act (show a plot, move the camera, open and arrange windows), and any web page open in a
 * browser on the same computer could otherwise send them, with an image or a fetch, while Collect Earth runs.
 * <ul>
 * <li>{@code Sec-Fetch-Site}, which browsers send on fetches, images and navigations alike, must be {@code same-origin}
 * (the plots map's requests) or {@code none} (an address the user opened) when it is there. Not {@code same-site}: for
 * localhost, a page of another program on another port is the same site.</li>
 * <li>{@code Origin}, sent on cross-origin requests and on POSTs, must be this server's own (scheme and Host) when it is
 * there.</li>
 * <li>The Host must name this computer (localhost, 127.0.0.1, [::1]) or the host Collect Earth is configured with
 * ({@link LocalPropertiesService#getHost()}): a page of another site whose name was made to point to 127.0.0.1 (DNS
 * rebinding) is of the same origin as far as the browser knows, but sends its own name as the Host.</li>
 * </ul>
 * A request with neither Sec-Fetch-Site nor Origin is let through if its Host is right: it is not from a page a browser
 * shows (or from a browser too old to say).
 * <p>
 * Not applied to the endpoints Google Earth Pro's balloons call (/openAuxiliaryWindows, /ancillaryWindows, the save and
 * update endpoints): their callers are not browsers Collect Earth controls, and what they send is not known. Mapped
 * before the other filters in web.xml, as GoogleEarthHeaderFilter answers "*" for a missing Origin.
 * <p>
 * The configured host comes from the LocalPropertiesService bean of the root application context, which the
 * ContextLoaderListener of web.xml starts before the filters: a filter that Jetty makes from web.xml is not a Spring
 * bean, and this reaches the bean without copying the setting anywhere. It is read on every request, as the setting is.
 */
public class OwnPagesOnlyFilter implements Filter {

	private static final String SEC_FETCH_SITE = "Sec-Fetch-Site";
	private static final String ORIGIN = "Origin";
	private static final String HOST = "Host";
	private static final List<String> SEC_FETCH_SITES_ALLOWED = Arrays.asList("same-origin", "none");
	private static final List<String> THIS_COMPUTER = Arrays.asList("localhost", "127.0.0.1", "[::1]");

	private final Logger logger = LoggerFactory.getLogger(OwnPagesOnlyFilter.class);
	private volatile LocalPropertiesService localPropertiesService;

	/**
	 * Whether a request with these headers may come from one of this server's own pages.
	 *
	 * @param secFetchSite   the {@code Sec-Fetch-Site} header, or null
	 * @param origin         the {@code Origin} header, or null
	 * @param scheme         the scheme of the request (http)
	 * @param host           the {@code Host} header (host and port, as the browser wrote them), or null
	 * @param configuredHost the host Collect Earth is configured with, or null
	 */
	static boolean isFromOwnPage(String secFetchSite, String origin, String scheme, String host, String configuredHost) {
		if (host == null || !isOwnHost(hostname(host), configuredHost)) {
			return false;
		}
		if (secFetchSite != null && !SEC_FETCH_SITES_ALLOWED.contains(secFetchSite.trim().toLowerCase(Locale.ROOT))) {
			return false;
		}
		// "null" (a sandboxed frame, a file) is no origin of ours either
		return origin == null || origin.trim().equalsIgnoreCase(scheme + "://" + host.trim());
	}

	/** The name in a Host header, without its port: "localhost", "127.0.0.1", "[::1]". */
	static String hostname(String host) {
		String h = host.trim().toLowerCase(Locale.ROOT);
		if (h.startsWith("[")) {
			int end = h.indexOf(']');
			return end < 0 ? h : h.substring(0, end + 1);
		}
		int colon = h.indexOf(':');
		return colon < 0 ? h : h.substring(0, colon);
	}

	private static boolean isOwnHost(String hostname, String configuredHost) {
		return THIS_COMPUTER.contains(hostname)
				|| configuredHost != null && !configuredHost.trim().isEmpty() && hostname.equals(hostname(configuredHost));
	}

	@Override
	public void init(FilterConfig filterConfig) {
		try {
			WebApplicationContext context = WebApplicationContextUtils
					.getWebApplicationContext(filterConfig.getServletContext());
			if (context != null) {
				localPropertiesService = context.getBean(LocalPropertiesService.class);
			}
		} catch (RuntimeException e) {
			logger.warn("The configured host is not known: only this computer's names may drive the imagery window", e);
		}
	}

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
			throws IOException, ServletException {
		HttpServletRequest http = (HttpServletRequest) request;
		LocalPropertiesService properties = localPropertiesService;
		String configuredHost = properties == null ? null : properties.getHost();
		if (!isFromOwnPage(http.getHeader(SEC_FETCH_SITE), http.getHeader(ORIGIN), http.getScheme(), http.getHeader(HOST),
				configuredHost)) {
			logger.warn("Refused {} from another site (Sec-Fetch-Site {}, Origin {}, Host {})", http.getRequestURI(),
					http.getHeader(SEC_FETCH_SITE), http.getHeader(ORIGIN), http.getHeader(HOST));
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

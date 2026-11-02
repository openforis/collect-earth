package org.openforis.collect.earth.app.server;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Enumeration;

import javax.servlet.http.HttpServletRequest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Whether a request comes from another Collect Earth started on this computer, the only legitimate caller of the
 * requests a second start sends to the running one (load a project file, open the window): the server has no
 * authentication.
 */
public final class LocalClients {

	private static final Logger logger = LoggerFactory.getLogger(LocalClients.class);

	private LocalClients() {
	}

	/** From this computer, and not from a browser, which a web page opened in this computer would fire it from */
	public static boolean isOtherCollectEarth(HttpServletRequest request) {
		return isLoopbackRequest(request) && !isSentByBrowser(request);
	}

	private static boolean isLoopbackRequest(HttpServletRequest request) {
		try {
			return InetAddress.getByName(request.getRemoteAddr()).isLoopbackAddress();
		} catch (UnknownHostException e) {
			logger.warn("Could not resolve the remote address " + request.getRemoteAddr(), e); //$NON-NLS-1$
			return false;
		}
	}

	/**
	 * Browsers identify themselves with these headers, the Java client used by Collect Earth sends none of them.
	 *
	 * The headers are read with getHeaders and not with getHeader because GoogleEarthHeaderFilter wraps every request and
	 * answers "*" to getHeader("Origin") when the request carries no Origin of its own, for the balloons of Google Earth.
	 * Through getHeader every request looks like it came from a browser.
	 */
	private static boolean isSentByBrowser(HttpServletRequest request) {
		return hasHeader(request, "Origin") || hasHeader(request, "Sec-Fetch-Site") //$NON-NLS-1$ //$NON-NLS-2$
				|| hasHeader(request, "Referer"); //$NON-NLS-1$
	}

	private static boolean hasHeader(HttpServletRequest request, String name) {
		Enumeration<String> values = request.getHeaders(name);
		return values != null && values.hasMoreElements();
	}
}

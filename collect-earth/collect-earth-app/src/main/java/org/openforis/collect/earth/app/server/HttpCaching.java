package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * How the browser keeps the pages of the plots map and the web form, and what they load. The web form is loaded anew for
 * every plot, with some 630 KB of scripts: without caching, all of it came again each time.
 * <ul>
 * <li>The files Vite builds with a hash of their content in the name ({@code form-BBM79X7o.js}) never change under that
 * name: kept a year without asking ({@link #IMMUTABLE}). Only those the build lists in its manifest
 * ({@link #MANIFEST}), served from /map/assets/: a file that only looks like one is asked for again.</li>
 * <li>The pages ({@code map.html}, {@code form.html}) name the files of the build they belong to, and the survey's form
 * changes with the survey: asked for again each time, with an ETag, so that the answer is a 304 with nothing in it while
 * they have not changed ({@link #REVALIDATE}).</li>
 * </ul>
 */
final class HttpCaching {

	static final String IMMUTABLE = "public, max-age=31536000, immutable"; //$NON-NLS-1$
	static final String REVALIDATE = "no-cache"; //$NON-NLS-1$
	/** The manifest of the Vite build, next to its files (build.manifest in vite.config.ts) */
	static final String MANIFEST = "build-manifest.json"; //$NON-NLS-1$

	/** Vite's names: {@code [name]-[hash].[ext]}, the hash 8 characters of base64url ({@code map-vh-t_kPv.css}) */
	private static final Pattern CONTENT_HASHED = Pattern.compile(".+-[A-Za-z0-9_-]{8}\\.[A-Za-z0-9]+"); //$NON-NLS-1$

	private HttpCaching() {
	}

	/** Whether the name of a file of the build carries the hash of its content; never an HTML page */
	static boolean isContentHashed(String file) {
		return file != null && !file.endsWith(".html") && CONTENT_HASHED.matcher(file).matches(); //$NON-NLS-1$
	}

	/**
	 * The Cache-Control of a file served from /map/assets/: kept a year when the build lists it and its name carries the
	 * hash of its content
	 *
	 * @param built
	 *            the files of the build ({@link #builtFiles}), empty when it has no manifest
	 */
	static String cacheControlFor(String file, Set<String> built) {
		return built.contains(file) && isContentHashed(file) ? IMMUTABLE : REVALIDATE;
	}

	/**
	 * The files a Vite manifest lists: the file of each entry, and the CSS and the assets it loads. None when there is no
	 * manifest or it cannot be read.
	 */
	static Set<String> builtFiles(InputStream manifest) {
		if (manifest == null) {
			return Collections.emptySet();
		}
		Set<String> files = new HashSet<>();
		try {
			for (JsonNode entry : new ObjectMapper().readTree(manifest)) {
				files.add(entry.path("file").asText()); //$NON-NLS-1$
				for (String list : new String[] { "css", "assets" }) { //$NON-NLS-1$ //$NON-NLS-2$
					for (JsonNode file : entry.path(list)) {
						files.add(file.asText());
					}
				}
			}
		} catch (IOException e) {
			return Collections.emptySet();
		}
		files.remove(""); //$NON-NLS-1$
		return Collections.unmodifiableSet(files);
	}

	/** A strong ETag of the content */
	static String etag(byte[] body) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256").digest(body); //$NON-NLS-1$
			StringBuilder tag = new StringBuilder("\""); //$NON-NLS-1$
			for (int i = 0; i < 12; i++) {
				tag.append(String.format("%02x", digest[i])); //$NON-NLS-1$
			}
			return tag.append('"').toString();
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}

	/** Whether the If-None-Match of the request names the ETag (weak or not, or "*") */
	static boolean matches(String ifNoneMatch, String etag) {
		if (ifNoneMatch == null || etag == null) {
			return false;
		}
		for (String tag : ifNoneMatch.split(",")) { //$NON-NLS-1$
			String trimmed = tag.trim();
			if (trimmed.startsWith("W/")) { //$NON-NLS-1$
				trimmed = trimmed.substring(2);
			}
			if (trimmed.equals("*") || trimmed.equals(etag)) { //$NON-NLS-1$
				return true;
			}
		}
		return false;
	}

	/**
	 * Sends the body with the Cache-Control given. One to revalidate also carries its ETag, and is answered 304 with no body
	 * when the browser has it already.
	 *
	 * @param etag the ETag of the body, or null to compute it
	 */
	static void send(HttpServletRequest request, HttpServletResponse response, byte[] body, String contentType,
			String cacheControl, String etag) throws IOException {
		response.setHeader("Cache-Control", cacheControl); //$NON-NLS-1$
		if (REVALIDATE.equals(cacheControl)) {
			String tag = etag == null ? etag(body) : etag;
			response.setHeader("ETag", tag); //$NON-NLS-1$
			if (request != null && matches(request.getHeader("If-None-Match"), tag)) { //$NON-NLS-1$
				response.setStatus(HttpServletResponse.SC_NOT_MODIFIED);
				return;
			}
		}
		response.setHeader("Content-Type", contentType); //$NON-NLS-1$
		response.setContentLength(body.length);
		response.getOutputStream().write(body);
	}
}

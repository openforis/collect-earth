package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * Serves the project file's own form (its balloon) to the panel of the plots map, when the project asks for it
 * (web_form=balloon), with its placeholders replaced by the plot's values and its files (earthFiles/, webFiles/) taken
 * from the folder the server serves them from (KmlGeneratorService.prepareProjectFiles).
 *
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Controller
public class BalloonServlet extends DataAccessingServlet {

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private static final String BALLOON_EXTERNAL_URL = "balloon"; //$NON-NLS-1$

	static String replaceGoalsWithParameters(String htmlWithGoals, Map<String, String[]> parameterMap) {
		final Set<Entry<String, String[]>> entrySet = parameterMap.entrySet();
		for (final Entry<String, String[]> entry : entrySet) {
			htmlWithGoals = htmlWithGoals.replaceAll("\\$\\[" + Pattern.quote( entry.getKey() ) + "\\]", Matcher.quoteReplacement( escape( entry.getValue()[0] ) )); //$NON-NLS-1$ //$NON-NLS-2$
		}
		return htmlWithGoals;
	}

	/**
	 * The values come from the request: escaped for the HTML, in text and in quoted attributes. The balloons use them
	 * in JavaScript strings too ({@code var PLACEMARK_ID = "$[id]";}), where an entity is not decoded but cannot end
	 * the string or the script either: no quote, backslash or {@code <} is left.
	 */
	static String escape(String value) {
		return StringUtils.replaceEach(value, new String[] { "&", "<", ">", "\"", "'", "\\" },
				new String[] { "&amp;", "&lt;", "&gt;", "&quot;", "&#39;", "&#92;" });
	}

	@GetMapping("/"+BALLOON_EXTERNAL_URL)
	public void returnBalloon(HttpServletResponse response, HttpServletRequest request, String imageName,
			@RequestParam(value = "web", required = false) Boolean web) throws IOException {
		response.setHeader("Content-Type", "text/html; charset=UTF-8"); //$NON-NLS-1$ //$NON-NLS-2$
		response.setHeader("Content-Disposition", "inline; filename=\"" + imageName + "\""); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		response.setHeader("Cache-Control", "max-age=30"); //$NON-NLS-1$ //$NON-NLS-2$
		response.setHeader("Date", new SimpleDateFormat(EarthConstants.DATE_FORMAT_HTTP, Locale.ENGLISH).format(new Date())); //$NON-NLS-1$

		final File balloonFile = resolveBalloonFile(web);

		String balloonContents = FileUtils.readFileToString( balloonFile, StandardCharsets.UTF_8 );

		if (balloonContents != null) {
			balloonContents = balloonContents.replace(EarthConstants.FOLDER_COPIED_TO_KMZ + "/", EarthConstants.GENERATED_FOLDER_SUFFIX + "/" //$NON-NLS-1$ //$NON-NLS-2$
					+ EarthConstants.FOLDER_COPIED_TO_KMZ + "/"); //$NON-NLS-1$
			balloonContents = balloonContents.replace(EarthConstants.FOLDER_WEB_FILES + "/", EarthConstants.GENERATED_FOLDER_SUFFIX + "/" //$NON-NLS-1$ //$NON-NLS-2$
					+ EarthConstants.FOLDER_WEB_FILES + "/"); //$NON-NLS-1$
			final Map<String, String[]> substitutionParams = Boolean.TRUE.equals(web)
					? buildWebSubstitutionParams(request.getParameterMap())
					: request.getParameterMap();
			balloonContents = replaceGoalsWithParameters(balloonContents, substitutionParams);

			final byte[] bytes = balloonContents.getBytes(StandardCharsets.UTF_8); // read as UTF-8 above
			response.setHeader("Content-Length", Integer.toString( bytes.length ) ); //$NON-NLS-1$ //$NON-NLS-2$
			writeToResponse(response, bytes);
		} else {
			getLogger().error("There was a problem fetching the balloon html, please check the name!"); //$NON-NLS-1$
		}
	}

	/**
	 * Builds the parameter map used to substitute the {@code $[...]} tokens for the
	 * web (Leaflet panel) balloon.
	 *
	 * <p>In the Google Earth path the KML template emits each placemark attribute as a
	 * {@code <Data name="EXTRA_id">...</Data>} element, so Google Earth substitutes
	 * {@code $[EXTRA_id]}, {@code $[EXTRA_round]}, etc. The web request, however, arrives
	 * with those same attributes as <b>unprefixed</b> query parameters ({@code id},
	 * {@code round}, {@code elevation}, {@code climate}, {@code soil}, {@code gez},
	 * {@code country}, {@code province}, {@code district}, {@code latitude},
	 * {@code longitude}, ...). To make the shared balloon HTML work unchanged in the web
	 * panel, we alias every request parameter under an additional {@code EXTRA_}-prefixed
	 * key, emulating the KML-template {@code EXTRA_} convention so that legacy balloons
	 * referencing {@code $[EXTRA_*]} resolve correctly.</p>
	 *
	 * <p>We also supply {@code $[plot_file]} (a token the KML template sources but that has
	 * no web-request equivalent) from the configured sample CSV file so it does not remain
	 * an unsubstituted literal in the served HTML.</p>
	 */
	private Map<String, String[]> buildWebSubstitutionParams(Map<String, String[]> requestParams) {
		final Map<String, String[]> augmented = new HashMap<>(requestParams);
		for (final Entry<String, String[]> entry : requestParams.entrySet()) {
			final String extraKey = "EXTRA_" + entry.getKey(); //$NON-NLS-1$
			// Do not overwrite an EXTRA_-prefixed param that was already sent explicitly.
			if (!augmented.containsKey(extraKey)) {
				augmented.put(extraKey, entry.getValue());
			}
		}
		if (!augmented.containsKey("plot_file")) { //$NON-NLS-1$
			final String csvFile = localPropertiesService.getCsvFile();
			augmented.put("plot_file", new String[] { csvFile != null ? csvFile : "" }); //$NON-NLS-1$ //$NON-NLS-2$
		}
		return augmented;
	}

	/**
	 * Resolves which balloon HTML file to serve. When the request asks for the web
	 * variant ({@code web=true}) and the CEP defines a {@code balloon_web} file that
	 * exists on disk, that modern web form is served. Otherwise (old CEPs without the
	 * property, or GEP-era requests) the legacy balloon file is used so that old
	 * projects degrade gracefully.
	 */
	private File resolveBalloonFile(Boolean web) {
		if (Boolean.TRUE.equals(web)) {
			final String webBalloonPath = localPropertiesService.getBalloonFileWeb();
			if (StringUtils.isNotBlank(webBalloonPath)) {
				final File webBalloonFile = new File(webBalloonPath);
				if (webBalloonFile.exists()) {
					return webBalloonFile;
				}
			}
		}
		return new File(localPropertiesService.getBalloonFile());
	}

	private void writeToResponse(HttpServletResponse response, byte[] fileContents) throws IOException {
		try {
			response.getOutputStream().write(fileContents);
		} catch (final Exception e) {
			getLogger().error("Error writing reponse body to output stream ", e); //$NON-NLS-1$
		} finally {
			response.getOutputStream().close();
		}
	}
}

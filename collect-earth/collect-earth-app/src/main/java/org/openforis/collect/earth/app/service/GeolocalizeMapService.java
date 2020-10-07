package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import freemarker.template.TemplateException;

/**
 * Customizes a Bing Map page to open zoomed into a coordinate. The HTML page is
 * created in a temporary file and its URL is returned so that it can be opened
 * in a browser. A freemarker template that contains the javascript code to
 * customize the Bing Map is used and the parameters for the specific
 * coordinates are applied to it. This service uses the same code than the KML
 * generator to get the plot sample deign as chosen through the configuration by
 * the user.
 *
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class GeolocalizeMapService {

	private static final String RESOURCES_FOLDER = "resources";

	/**
	 * The file that contains the freemarker template used to produce the Bing Maps
	 * code.
	 */
	public static final String FREEMARKER_BING_HTML_TEMPLATE = RESOURCES_FOLDER + File.separator + "collectBing.fmt";

	public static final String FREEMARKER_BAIDU_HTML_TEMPLATE = RESOURCES_FOLDER + File.separator + "collectBaidu.fmt";

	public static final String FREEMARKER_PLANET_HTML_TEMPLATE = RESOURCES_FOLDER + File.separator + "collectPlanetMonthlyHtml.fmt";

	public static final String FREEMARKER_PLANET_URL_TEMPLATE = RESOURCES_FOLDER + File.separator
			+ "collectPlanetUrl.fmt";

	/**
	 * The file that contains the freemarker template used to produce the Yandex
	 * Maps code.
	 */
	public static final String FREEMARKER_YANDEX_HTML_TEMPLATE = RESOURCES_FOLDER + File.separator
			+ "collectYandex.fmt";

	public static final String FREEMARKER_GEE_PLAYGROUND_TEMPLATE_FILE_NAME = "eePlaygroundScript.fmt";
	public static final String FREEMARKER_GEE_CODE_EDITOR_TEMPLATE_FILE_NAME = "eeCodeEditorScript.fmt";

	/**
	 * The file that contains the freemarker template used to produce script that is
	 * run in GEE Code Editor.
	 */
	public static final String FREEMARKER_GEE_PLAYGROUND_TEMPLATE = RESOURCES_FOLDER + File.separator
			+ FREEMARKER_GEE_PLAYGROUND_TEMPLATE_FILE_NAME;
	public static final String FREEMARKER_GEE_CODE_EDITOR_TEMPLATE = RESOURCES_FOLDER + File.separator
			+ FREEMARKER_GEE_CODE_EDITOR_TEMPLATE_FILE_NAME;

	public static final String FREEMARKER_HERE_HTML_TEMPLATE = RESOURCES_FOLDER + File.separator
			+ "collectHereMaps.fmt";

	public static final String FREEMARKER_STREET_VIEW_HTML_TEMPLATE = RESOURCES_FOLDER + File.separator
			+ "collectStreetView.fmt";
	@Autowired
	LocalPropertiesService localPropertiesService;

	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	@Autowired
	KmlGeneratorService kmlGeneratorService;

	public void addDatesForImages(final Map<String, Object> data) {
		SimpleDateFormat dt1 = new SimpleDateFormat("yyyy-MM-dd");
		Date todayDate = new Date();
		String dateAsExpected = dt1.format(todayDate);
		data.put("todayDate", dateAsExpected);

		Calendar cal = Calendar.getInstance();
		cal.setTime(todayDate);
		cal.add(Calendar.YEAR, -1);

		data.put("oneYearAgoDate", dt1.format(cal.getTime()));

	}

	private File applyData(Map<String, Object> data, String freemarkerTemplateFile)
			throws IOException, TemplateException {

		final File templateFileSrc = new File(freemarkerTemplateFile);

		final File tempFileDst = File.createTempFile("selenium", ".html");
		tempFileDst.deleteOnExit();

		FreemarkerTemplateUtils.applyTemplate(templateFileSrc, tempFileDst, data);

		return tempFileDst;

	}

	public Map<String, Object> getPlacemarkData(SimplePlacemarkObject placemarkObject) {
		final Map<String, Object> data = new HashMap<>();
		data.put("placemark", placemarkObject);
		return data;
	}

	/**
	 * Produces a temporary file with the necessary HTML code to show the plot in
	 * Bing Maps
	 *
	 * @param placemarkObject
	 *            The object containing information of the placemark.
	 * @param freemarkerTemplate
	 *            The path to the freemarker template that is used to produce the
	 *            file.
	 * @return The URL to the temporary file that can be used to load it in a
	 *         browser.
	 */
	public URL getTemporaryUrl(SimplePlacemarkObject placemarkObject, String freemarkerTemplate) {
		final Map<String, Object> data = getPlacemarkData(placemarkObject);
		addDatesForImages(data);
		return processTemplateWithData(freemarkerTemplate, data);
	}

	/**
	 * Produces a URL using Planet Labs explorer expected format
	 *
	 * @param placemarkObject
	 *            The data of the plot.
	 * @param freemarkerTemplate
	 *            The freemarker template file to use
	 * @param extraData
	 * 				Variable listof key value strings
	 * @return The URL to the temporary file that can be used to load it in a
	 *         browser.
	 */
	public URL getUrlToFreemarkerOutput(SimplePlacemarkObject placemarkObject, String freemarkerTemplate,
			String... extraData) {

		final Map<String, Object> data = getPlacemarkData(placemarkObject);

		if( extraData !=null) {
			for (int i = 0; i < extraData.length; i = i+2) {
				data.put(extraData[i], extraData[i+1]);
			}
		}
		return processTemplateWithData(freemarkerTemplate, data);

	}


	private URL processTemplateWithData(String freemarkerTemplate, final Map<String, Object> data) {
		File transformedHtml = null;
		try {
			transformedHtml = applyData(data, freemarkerTemplate);
		} catch (final Exception e) {
			logger.error("Exception when applying template " + freemarkerTemplate + "with data : " + data.toString(),
					e);
		}
		if (transformedHtml != null) {
			try {
				return transformedHtml.toURI().toURL();
			} catch (MalformedURLException e) {
				logger.error("Error generating URL for File " + transformedHtml.getAbsolutePath());
				return null;
			}
		} else {
			logger.error("No Bing map HTML generated.");
			return null;
		}
	}
}

package org.openforis.collect.earth.app.server;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.StringWriter;
import java.io.UnsupportedEncodingException;
import java.io.Writer;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import javax.annotation.PostConstruct;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.model.CollectRecord;
import org.openforis.idm.model.TextAttribute;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

/**
 * Servlet called by the NetworkLink which tries to update the status of the placemark icons every few seconds.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Controller
public class PlacemarkUpdateServlet {

	private static final String KML_FOR_UPDATES = "resources/updateIcons.fmt";
	private final Logger logger = LoggerFactory.getLogger(PlacemarkUpdateServlet.class);

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private static final Configuration cfg = new Configuration();
	private static Template template;
	
	@PostConstruct
	private void init(){
		try {
			// Force the local properties to be updated so we get the right generatedOn info
			localPropertiesService.init();
			
		} catch (IOException e) {
			logger.error("Error refreshing the local porperties");
		}
	}

	private String getKmlFromTemplate( Map<String, Object> data) throws IOException {

		intializeTemplate();
		// Console output
		final StringWriter fw = new StringWriter();
		final Writer out = new BufferedWriter(fw);
		try {
			// Add date to avoid caching
			template.process(data, out);
		} catch (final TemplateException e) {
			logger.error("Error when producing starter KML from template", e);
		} finally {
			out.flush();
			fw.close();
		}

		return fw.toString();

	}

	private void intializeTemplate() throws IOException {
		if (template == null) {
			// Load template from source folder
			template = cfg.getTemplate(KML_FOR_UPDATES);
		}
	}

	private String[] getPlacemarksId(List<CollectRecord> lastUpdatedRecord) {
		if (lastUpdatedRecord == null) {
			return new String[0];
		}
		final String[] placemarIds = new String[lastUpdatedRecord.size()];
		for (int i = 0; i < lastUpdatedRecord.size(); i++) {
			if (lastUpdatedRecord.get(i).getRootEntity().get("id", 0) != null) {
				placemarIds[i] = ((TextAttribute) lastUpdatedRecord.get(i).getRootEntity().get("id", 0)).getValue().getValue();
			}
		}

		return placemarIds;
	}

	/**
	 * Responds with KML code that causes the Google Earth placemark icon and overlay image to update is status ( filled/not-filled/partially-filled)
	 * 
	 * @param response
	 * @param lastUpdate
	 *            The date that this request was last sent. This way we get the placemarks that have changed status since the last time this was
	 *            checked.
	 */
	@RequestMapping("/placemarkUpdate")
	public void getUpdatePlacemark(HttpServletResponse response, @RequestParam(value = "lastUpdate", required = false) String lastUpdate) {

		try {
			//long time = System.currentTimeMillis();
			
			final SimpleDateFormat dateFormat = new SimpleDateFormat(EarthConstants.DATE_FORMAT_HTTP, Locale.ENGLISH );
			Date lastUpdateDate = null;
			if (lastUpdate != null && lastUpdate.length() > 0) {
				lastUpdateDate = dateFormat.parse(lastUpdate);
			}
		
			final List<CollectRecord> lastUpdatedRecord = earthSurveyService.getRecordsSavedSince(lastUpdateDate);
			
			final Map<String, Object> data = new HashMap<String, Object>();
			data.put("host", KmlGenerator.getHostAddress(localPropertiesService.getHost(), localPropertiesService.getLocalPort()));
			data.put("date", getUpdateFromDate(dateFormat) );
			data.put("kmlGeneratedOn", localPropertiesService.getGeneratedOn());
			data.put("placemark_ids", getPlacemarksId(lastUpdatedRecord));
	
			setKmlResponse(response, getKmlFromTemplate(data), dateFormat);
			
			//System.out.println("Placemark update takes " + ( System.currentTimeMillis() - time ) );
		} catch (final ParseException e) {
			logger.error("Error in the lastUpdate date format : " + lastUpdate, e);
		} catch (final IOException e) {
			logger.error("Error generating the update KML.", e);
		}

	}

	private String getUpdateFromDate(final SimpleDateFormat dateFormat) throws UnsupportedEncodingException {
		Calendar cal = Calendar.getInstance();
		cal.add(Calendar.MINUTE, -1);
		return URLEncoder.encode(dateFormat.format(cal.getTime()), "UTF-8" );
	}

	private void setKmlResponse(HttpServletResponse response, String kmlCode, SimpleDateFormat dateFormat) throws IOException {
		response.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
		response.setHeader("Cache-Control", "max-age=30");
		response.setHeader("Date", dateFormat.format(new Date()));
		response.setHeader("Content-Length", kmlCode.getBytes(Charset.forName("UTF-8")).length + "");
		response.getOutputStream().write(kmlCode.getBytes(Charset.forName("UTF-8")));
		response.getOutputStream().close();
	}

}

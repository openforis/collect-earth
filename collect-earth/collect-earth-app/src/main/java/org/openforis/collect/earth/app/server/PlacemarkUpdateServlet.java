package org.openforis.collect.earth.app.server;

import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.StringWriter;
import java.io.UnsupportedEncodingException;
import java.io.Writer;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.openforis.collect.model.CollectRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

import freemarker.cache.FileTemplateLoader;
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

	private static final String STANDARD_KML_FOR_UPDATES_FILENAME = "updateIcons.fmt"; //$NON-NLS-1$
	private static final String GENERIC_KML_FOR_UPDATES = "resources/" + STANDARD_KML_FOR_UPDATES_FILENAME; //$NON-NLS-1$
	private final Logger logger = LoggerFactory.getLogger(PlacemarkUpdateServlet.class);

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private static final Configuration cfg = new Configuration();

	private static Template template;
  

	private String getKmlFromTemplate( Map<String, Object> data) throws IOException {

		intializeTemplate();
		// Console output
		final StringWriter fw = new StringWriter();
		final Writer out = new BufferedWriter(fw);
		try {
			// Add date to avoid caching
			template.process(data, out);
		} catch (final TemplateException e) {
			logger.error("Error when producing starter KML from template", e); //$NON-NLS-1$
		} finally {
			out.flush();
			fw.close();
		}

		return fw.toString();

	}

	private void intializeTemplate() throws IOException {
		if (template == null) {
			
			// first check if there is a custom update template included on the customization that can be used for the project
			
			String possibleUpdateKmlLocation = localPropertiesService.getProjectFolder() + File.separatorChar + STANDARD_KML_FOR_UPDATES_FILENAME;
			File possibleKmlFile = new File( possibleUpdateKmlLocation );
			
			if( possibleKmlFile.exists() ){
				
				/*
				 * We need to create a new TemplateLoader and use it momentarily as by default the Template loader 
				 * uses the basedir of the project which causes problems when loading file from outside the project folder
				 */
				cfg.setTemplateLoader( new FileTemplateLoader( new File( possibleKmlFile.getParent() ) ) ); 
				template = cfg.getTemplate( STANDARD_KML_FOR_UPDATES_FILENAME );
				
			}else{
				// No specific updatekml template found on the project folder, fall back to the general one
				// Load template from the resource folder
				template = cfg.getTemplate(GENERIC_KML_FOR_UPDATES);
			}
		}
	}



	/**
	 * Responds with KML code that causes the Google Earth placemark icon and overlay image to update is status ( filled/not-filled/partially-filled)
	 * 
	 * @param response The HTTP response object
	 * @param lastUpdate The datetime when this servlet was last called by the Google Earth network link.
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
		
			List<CollectRecord> lastUpdatedRecords = null;
			try {
				lastUpdatedRecords = earthSurveyService.getRecordSummariesSavedSince(lastUpdateDate);
			} catch (Exception e) {
				lastUpdatedRecords = new ArrayList<CollectRecord>();
				logger.error("Error fetching information about the records updated after : " + lastUpdatedRecords , e); //$NON-NLS-1$
			}
			
			final Map<String, Object> data = new HashMap<String, Object>();
			data.put("host", ServerController.getHostAddress(localPropertiesService.getHost(), localPropertiesService.getLocalPort())); //$NON-NLS-1$
			data.put("date", getUpdateFromDate(dateFormat) ); // Keep for historical reasons //$NON-NLS-1$
			data.put("lastUpdateDateTime", getUpdateFromDate(dateFormat) ); //$NON-NLS-1$
			data.put("uniqueId", FreemarkerTemplateUtils.randInt(10000, 5000000) ); //$NON-NLS-1$
			data.put("kmlGeneratedOn", localPropertiesService.getGeneratedOn()); //$NON-NLS-1$
			data.put("placemark_ids", earthSurveyService.getPlacemarksId(lastUpdatedRecords)); //$NON-NLS-1$
	
			setKmlResponse(response, getKmlFromTemplate(data), dateFormat);
			
		} catch (final ParseException e) {
			logger.error("Error in the lastUpdate date format : " + lastUpdate, e); //$NON-NLS-1$
		} catch (final IOException e) {
			logger.error("Error generating the update KML.", e); //$NON-NLS-1$
		}catch (final Exception e) {
			logger.error("Error generating the update KML.", e); //$NON-NLS-1$
		}

	}

	private String getUpdateFromDate(final SimpleDateFormat dateFormat) throws UnsupportedEncodingException {
		Calendar cal = Calendar.getInstance();
		cal.add(Calendar.MINUTE, -1);
		return URLEncoder.encode(dateFormat.format(cal.getTime()), "UTF-8" ); //$NON-NLS-1$
	}

	private void setKmlResponse(HttpServletResponse response, String kmlCode, SimpleDateFormat dateFormat) throws IOException {
		response.setHeader("Content-Type", "application/vnd.google-earth.kml+xml"); //$NON-NLS-1$ //$NON-NLS-2$
		response.setHeader("Cache-Control", "max-age=30"); //$NON-NLS-1$ //$NON-NLS-2$
		response.setHeader("Date", dateFormat.format(new Date())); //$NON-NLS-1$
		response.setHeader("Content-Length", kmlCode.getBytes(Charset.forName("UTF-8")).length + ""); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		response.getOutputStream().write(kmlCode.getBytes(Charset.forName("UTF-8"))); //$NON-NLS-1$
		response.getOutputStream().close();
	}
	
	
	
}

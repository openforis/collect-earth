package org.openforis.collect.earth.app.server;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.StringWriter;
import java.io.Writer;
import java.text.ParseException;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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

@Controller
public class PlacemarkUpdateServlet {

	private static final String KML_FOR_UPDATES = "resources/updateIcons.fmt";
	private static final Logger logger = LoggerFactory.getLogger(PlacemarkUpdateServlet.class);

	@Autowired
	EarthSurveyService earthSurveyService;

	@Autowired
	LocalPropertiesService localPropertiesService = new LocalPropertiesService();

	@RequestMapping("/placemarkUpdate")
	public void getUpdatePlacemark(HttpServletResponse response,
			@RequestParam(value = "lastUpdate", required = false) String lastUpdate) {

		try {
			Date lastUpdateDate = null;
			if (lastUpdate != null && lastUpdate.length() > 0) {
				lastUpdateDate = EarthConstants.DATE_FORMAT_HTTP.parse(lastUpdate);
			}

			List<CollectRecord> lastUpdatedRecord = earthSurveyService.getRecordsSavedSince(lastUpdateDate);

			Map<String, Object> data = new HashMap<String, Object>();
			data.put("host", KmlGenerator.getHostAddress(localPropertiesService.getHost(), localPropertiesService.getPort()));
			data.put("date", EarthConstants.DATE_FORMAT_HTTP.format(new Date()));
			data.put("kmlGeneratedOn", localPropertiesService.getGeneratedOn());
			data.put("placemark_ids", getPlacemarksId(lastUpdatedRecord));

			setKmlResponse(response, getKmlFromTemplate(data));
		} catch (ParseException e) {
			logger.error("Error in the lastUpdate date format : " + lastUpdate, e);
		} catch (IOException e) {
			logger.error("Error generating the update KML.", e);
		}

	}

	private String[] getPlacemarksId(List<CollectRecord> lastUpdatedRecord) {
		if (lastUpdatedRecord == null) {
			return new String[0];
		}
		String[] placemarIds = new String[lastUpdatedRecord.size()];
		for (int i = 0; i < lastUpdatedRecord.size(); i++) {
			if (lastUpdatedRecord.get(i).getRootEntity().get("id", 0) != null) {
				placemarIds[i] = ((TextAttribute) lastUpdatedRecord.get(i).getRootEntity().get("id", 0)).getValue().getValue();
			}
		}

		return placemarIds;
	}

	private String getKmlFromTemplate(Map data) throws IOException {
		// Process the template file using the data in the "data" Map
		Configuration cfg = new Configuration();
		// Load template from source folder
		Template template = cfg.getTemplate(KML_FOR_UPDATES);

		// Console output
		StringWriter fw = new StringWriter();
		Writer out = new BufferedWriter(fw);
		try {
			// Add date to avoid caching
			template.process(data, out);

		} catch (TemplateException e) {
			logger.error("Error when producing starter KML from template", e);
		}
		out.flush();
		fw.close();

		return fw.toString();

	}

	private void setKmlResponse(HttpServletResponse response, String kmlCode) throws IOException {
		response.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
		response.setHeader("Cache-Control", "max-age=30");
		response.setHeader("Date", EarthConstants.DATE_FORMAT_HTTP.format(new Date()));
		response.setHeader("Content-Length", kmlCode.getBytes().length + "");
		response.getOutputStream().write(kmlCode.getBytes());
		response.getOutputStream().close();
	}


}

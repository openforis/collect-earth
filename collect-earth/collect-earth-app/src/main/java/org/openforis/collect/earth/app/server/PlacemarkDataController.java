package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.logging.GAlogger;
import org.openforis.collect.earth.app.service.PlotTimeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;

import com.google.gson.Gson;

/**
 * Controller to load and store the information that is stored in Collect Earth for one placemark (plot)
 *
 * @author Alfonso Sanchez-Paus Diaz
 * @author S. Ricci
 *
 */
@Controller
public class PlacemarkDataController extends AbstractPlacemarkDataController {

	/** Counts the active time spent on each plot from the form's loads and saves (and its "still here"). */
	@Autowired(required = false)
	private PlotTimeService plotTimes;

	private void work(String placemarkId) {
		// not the survey designer's preview, nor the test plot of a balloon ("$[id]")
		if (plotTimes != null && placemarkId != null && !placemarkId.contains("$[")) { //$NON-NLS-1$
			plotTimes.work(placemarkId);
		}
	}

	/**
	 * The web form's "still here": sent while the interpreter uses the open plot's form without saving (reading, looking
	 * at the imagery with the form in front), so that time counts too. Answers 204.
	 */
	@PostMapping(value="/plot-activity")
	public void plotActivity(@RequestParam("id") String placemarkId, HttpServletResponse response) {
		work(placemarkId);
		response.setStatus(HttpServletResponse.SC_NO_CONTENT);
	}
	@Override
	@GetMapping(value="/placemark-info-expanded")
	public void placemarkInfoExpanded(@RequestParam("id") String placemarkId, HttpServletResponse response) throws IOException {
		try{
			work(placemarkId);
			super.placemarkInfoExpanded(placemarkId, response);
		}catch(Exception e){
			logger.error("Error loading the data of plot " + placemarkId, e);
			sendError(response);
		}
	}

	@Override
	@PostMapping(value="/save-data-expanded")
	public void saveDataExpanded(PlacemarkUpdateRequest updateRequest, HttpServletResponse response) throws IOException {
		try{
			work(updateRequest.getPlacemarkId());
			super.saveDataExpanded(updateRequest, response);
			if( "true".equals(updateRequest.getValues().get("collect_boolean_actively_saved"))) {
				GAlogger.logGAnalytics("PlotSavedCollectEarth");
			}
		}catch(Exception e){
			logger.error("Error saving data" , e);
			sendError(response);
		}
	}

	@Override
	@PostMapping(value="/create-entity")
	public void createEntity(PlacemarkEntityCreateParams params, HttpServletResponse response) throws IOException {
		try{
			work(params.getPlacemarkId());
			super.createEntity(params, response);
		}catch(Exception e){
			logger.error("Error adding " + params.getEntityName() + " to plot " + params.getPlacemarkId(), e);
			sendError(response);
		}
	}

	@Override
	@PostMapping(value="/delete-entity")
	public void deleteEntity(PlacemarkEntityCreateParams params, HttpServletResponse response) throws IOException {
		try{
			work(params.getPlacemarkId());
			super.deleteEntity(params, response);
		}catch(Exception e){
			logger.error("Error deleting " + params.getEntityName() + " from plot " + params.getPlacemarkId(), e);
			sendError(response);
		}
	}

	/**
	 * A failure answers 500 with {@code {"success": false, "message": ""}}. It used to answer an empty 200, which the web
	 * form took for Collect Earth not answering at all, and which the balloons could not read either (they fail on a body
	 * that is not JSON, as on a 500). The message is empty: what failed is in the log, and an exception says nothing to
	 * the collector, so the forms say it in their own words (the reasons meant for the collector come with a 200, from
	 * the survey service). The headers set before (CORS, filters) stay; nothing is sent once the answer has started.
	 */
	static void sendError(HttpServletResponse response) throws IOException {
		if (response.isCommitted()) {
			return;
		}
		response.resetBuffer();
		response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
		response.setContentType("application/json;charset=UTF-8"); //$NON-NLS-1$
		response.setHeader("Cache-Control", "no-store"); //$NON-NLS-1$ //$NON-NLS-2$
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("success", false); //$NON-NLS-1$
		body.put("message", ""); //$NON-NLS-1$ //$NON-NLS-2$
		response.getWriter().print(new Gson().toJson(body));
		response.getWriter().flush();
	}

}

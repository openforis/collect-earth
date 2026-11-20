package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.servlet.http.HttpServletResponse;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.logging.GAlogger;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.PlotTimeService;
import org.openforis.collect.earth.app.service.cloud.CorrectionService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
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

	@Autowired(required = false)
	private LocalPropertiesService properties;

	void setProperties(LocalPropertiesService properties) {
		this.properties = properties;
	}

	/** The plots the person corrects, kept apart from the local database (absent in some tests) */
	@Autowired(required = false)
	private CorrectionService corrections;

	void setCorrections(CorrectionService corrections) {
		this.corrections = corrections;
	}

	/**
	 * While the person corrects plots, the plots file is theirs to correct, and the form saves through the correction
	 * calls below, never into the local database: a form of before (opened on the person's own plots) is refused,
	 * rather than storing a record with the keys of a plot to correct. Answers 200 with the reason, as without a name.
	 */
	boolean refusedWhileCorrecting(String placemarkId, HttpServletResponse response) throws IOException {
		if (corrections == null || placemarkId == null || placemarkId.contains("$[") || !corrections.isOpen()) { //$NON-NLS-1$
			return false;
		}
		PlacemarkLoadResult result = new PlacemarkLoadResult();
		result.setSuccess(false);
		result.setMessage(Messages.getString("Corrections.formOfBefore")); //$NON-NLS-1$
		setJsonResponse(response, result);
		return true;
	}

	private CorrectionService corrections() {
		if (corrections == null) {
			throw new IllegalStateException("No corrections here"); //$NON-NLS-1$
		}
		return corrections;
	}

	/**
	 * No plot is stored before the person has a name: it is written in every plot saved (its operator), and a plot
	 * without one is nobody's, so it is not sent as theirs when they join a cloud project (CloudRecordsSender). The
	 * window asks for the name before anything else (appBar.ts operatorRequired); this also holds for the balloons of
	 * Google Earth and for a project file opened by itself. Answers 200 with the reason, which the forms show.
	 */
	boolean refusedWithoutName(String placemarkId, HttpServletResponse response) throws IOException {
		if (properties == null || placemarkId == null || placemarkId.contains("$[") //$NON-NLS-1$
				|| StringUtils.isNotBlank(properties.getOperator())) {
			return false;
		}
		PlacemarkLoadResult result = new PlacemarkLoadResult();
		result.setSuccess(false);
		result.setMessage(Messages.getString(properties.isCloudSyncEnabled() ? "PlacemarkDataController.signInFirst" //$NON-NLS-1$
				: "PlacemarkDataController.nameFirst")); //$NON-NLS-1$
		setJsonResponse(response, result);
		return true;
	}

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
			if (refusedWithoutName(updateRequest.getPlacemarkId(), response)
					|| refusedWhileCorrecting(updateRequest.getPlacemarkId(), response)) {
				return;
			}
			work(updateRequest.getPlacemarkId());
			super.saveDataExpanded(updateRequest, response);
			if( updateRequest.getValues() != null && "true".equals(updateRequest.getValues().get("collect_boolean_actively_saved"))) {
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
			if (refusedWithoutName(params.getPlacemarkId(), response)
					|| refusedWhileCorrecting(params.getPlacemarkId(), response)) {
				return;
			}
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
			if (refusedWhileCorrecting(params.getPlacemarkId(), response)) {
				return;
			}
			work(params.getPlacemarkId());
			super.deleteEntity(params, response);
		}catch(Exception e){
			logger.error("Error deleting " + params.getEntityName() + " from plot " + params.getPlacemarkId(), e);
			sendError(response);
		}
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Correcting plots others answered (CorrectionService): the form's calls with correction=1 in its address. The
	// record is kept apart from the local database; the time spent is not counted as the person's plot's.

	@GetMapping(value="/correction-info-expanded")
	public void correctionInfoExpanded(@RequestParam("id") String placemarkId, HttpServletResponse response) throws IOException {
		try {
			setJsonResponse(response, corrections().load(placemarkId));
		} catch (Exception e) {
			logger.error("Error loading the correction of plot " + placemarkId, e);
			sendError(response);
		}
	}

	@PostMapping(value="/correction-save-expanded")
	public void correctionSaveExpanded(PlacemarkUpdateRequest updateRequest, HttpServletResponse response) throws IOException {
		try {
			if (refusedWithoutName(updateRequest.getPlacemarkId(), response)) {
				return;
			}
			Map<String, String> values = adjustParameters(updateRequest);
			if (values.isEmpty()) {
				setJsonResponse(response, handleEmptyCollectedData());
				return;
			}
			setJsonResponse(response, corrections().save(updateRequest.getPlacemarkId(), new java.util.HashMap<>(values), updateRequest.isPartialUpdate()));
		} catch (Exception e) {
			logger.error("Error saving the correction of plot " + updateRequest.getPlacemarkId(), e);
			sendError(response);
		}
	}

	@PostMapping(value="/correction-create-entity")
	public void correctionCreateEntity(PlacemarkEntityCreateParams params, HttpServletResponse response) throws IOException {
		try {
			if (refusedWithoutName(params.getPlacemarkId(), response)) {
				return;
			}
			setJsonResponse(response, corrections().addEntity(params.getPlacemarkId(), params.getEntityName(), new java.util.HashMap<>(adjustParameters(params))));
		} catch (Exception e) {
			logger.error("Error adding " + params.getEntityName() + " to the correction of plot " + params.getPlacemarkId(), e);
			sendError(response);
		}
	}

	@PostMapping(value="/correction-delete-entity")
	public void correctionDeleteEntity(PlacemarkEntityCreateParams params, HttpServletResponse response) throws IOException {
		try {
			setJsonResponse(response, corrections().deleteEntity(params.getPlacemarkId(), params.getEntityName()));
		} catch (Exception e) {
			logger.error("Error deleting " + params.getEntityName() + " from the correction of plot " + params.getPlacemarkId(), e);
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

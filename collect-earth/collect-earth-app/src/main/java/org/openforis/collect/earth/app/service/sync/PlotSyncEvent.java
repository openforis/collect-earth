package org.openforis.collect.earth.app.service.sync;

import java.util.Date;
import java.util.Map;

public class PlotSyncEvent {

	private String eventId;
	private String projectId;
	private String clientId;
	private String plotKey;
	private String operation;
	private int baseRevision;
	private Map<String, String> payload;
	private Date createdAt;

	public String getEventId() {
		return eventId;
	}

	public void setEventId(String eventId) {
		this.eventId = eventId;
	}

	public String getProjectId() {
		return projectId;
	}

	public void setProjectId(String projectId) {
		this.projectId = projectId;
	}

	public String getClientId() {
		return clientId;
	}

	public void setClientId(String clientId) {
		this.clientId = clientId;
	}

	public String getPlotKey() {
		return plotKey;
	}

	public void setPlotKey(String plotKey) {
		this.plotKey = plotKey;
	}

	public String getOperation() {
		return operation;
	}

	public void setOperation(String operation) {
		this.operation = operation;
	}

	public int getBaseRevision() {
		return baseRevision;
	}

	public void setBaseRevision(int baseRevision) {
		this.baseRevision = baseRevision;
	}

	public Map<String, String> getPayload() {
		return payload;
	}

	public void setPayload(Map<String, String> payload) {
		this.payload = payload;
	}

	public Date getCreatedAt() {
		return createdAt;
	}

	public void setCreatedAt(Date createdAt) {
		this.createdAt = createdAt;
	}
}

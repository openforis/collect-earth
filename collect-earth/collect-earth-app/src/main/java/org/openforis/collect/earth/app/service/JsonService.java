package org.openforis.collect.earth.app.service;

import java.io.IOException;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Map;

import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.EarthConstants;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

public class JsonService {

	Gson gson = new GsonBuilder().create();

	public void setJsonResponse(HttpServletResponse response, Map<String, String> collectedData) throws IOException {
		if (collectedData != null && collectedData.size() > 0) {

			String json = gson.toJson(collectedData);

			setResponseHeaders(response);
			PrintWriter out = response.getWriter();

			out.println(json);

			out.close();
		}
	}

	private void setResponseHeaders(HttpServletResponse response) {
		response.setContentType("application/json");
		response.setStatus(HttpServletResponse.SC_OK);
		response.setHeader("Cache-control", "no-cache, no-store");
		response.setHeader("Pragma", "no-cache");
		response.setHeader("Expires", "-1");
		response.setHeader("Date", new SimpleDateFormat(EarthConstants.DATE_FORMAT_HTTP).format(new Date()));
		response.setHeader("Access-Control-Allow-Origin", "*");
		response.setHeader("Access-Control-Allow-Methods", "POST");
		response.setHeader("Access-Control-Allow-Headers", "Content-Type");
		response.setHeader("Access-Control-Max-Age", "86400");
	}
}

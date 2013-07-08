package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.service.JsonService;
import org.springframework.beans.factory.annotation.Autowired;

public abstract class JsonPocessorServlet extends DataAccessingServlet {

	@Autowired
	private JsonService jsonService;

	protected JsonService getJsonService() {
		return jsonService;
	}

	protected Map<String, String> extractRequestData(HttpServletRequest request) {
		Map<String, String> collectedData = new HashMap<String, String>();

		@SuppressWarnings("rawtypes")
		Enumeration enParams = request.getParameterNames();
		while (enParams.hasMoreElements()) {

			String paramName = (String) enParams.nextElement();
			String[] values = request.getParameterValues(paramName);
			if (values.length == 1) {
				collectedData.put(paramName, values[0]);
			} else {
				int i = 1;
				for (String val : values) {
					collectedData.put(paramName + "_" + i, val);
					i++;
				}
			}
		}
		return collectedData;
	}

	protected abstract void processRequest(HttpServletRequest request, HttpServletResponse response) throws IOException;

	protected void setResult(boolean success, String message, Map<String, String> collectedData) {
		collectedData.put("type", success ? "success" : "error"); // success,error,warning
		collectedData.put("message", message);
	}

}
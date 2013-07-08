package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.Map;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
public class SaveEarthDataServlet extends JsonPocessorServlet {


	@Override
	@RequestMapping("/saveData")
	protected void processRequest(HttpServletRequest request, HttpServletResponse response) throws IOException {

		Map<String, String> collectedData = extractRequestData(request);

		// REMOVE THIS!!!!
		if (collectedData.get("collect_text_id").equals("$[id]")) {
			collectedData.put("collect_text_id", "testPlacemark");
		}

		if (collectedData.size() == 0) {
			setResult(false, "Empty request", collectedData);
			getLogger().info("The request was empty");
		} else {
			if (getDataAccessor().saveData(collectedData)) {
				setResult(true, "The data was saved", collectedData);
				getLogger().info("The data was saved for " + collectedData.toString());

			} else {
				setResult(false, "Problem occurred while saving data to the database", collectedData);
				getLogger().error("The data could not be saved for " + collectedData.toString());
			}
		}

		getJsonService().setJsonResponse(response, collectedData);
	}

}
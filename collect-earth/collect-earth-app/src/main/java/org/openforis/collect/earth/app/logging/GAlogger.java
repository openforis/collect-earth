package org.openforis.collect.earth.app.logging;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;

import org.apache.http.HttpResponse;
import org.apache.http.client.HttpClient;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.utils.URIBuilder;
import org.apache.http.impl.client.HttpClientBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class GAlogger {

	private static final Logger logger = LoggerFactory.getLogger(GAlogger.class);

	public static void logGAnalytics(String event) {
		new Thread("GA logging thread") {

			@Override
			public void run() {
				try {
					String trackingId = "UA-55115982-1";
					HttpClient client = HttpClientBuilder.create().build();
					URIBuilder builder = new URIBuilder();
					builder.setScheme("http").setHost("www.google-analytics.com").setPath("/collect")
							.addParameter("v", "1") // API Version.
							.addParameter("tid", trackingId) // Tracking ID / Property ID.
							// Anonymous Client Identifier. Ideally, this should be a UUID that
							// is associated with particular user, device, or browser instance.
							.addParameter("cid", "555").addParameter("t", "event") // Event hit type.
							.addParameter("ec", "Collect Earth") // Event category.
							.addParameter("ea", event); // Event action.
					URI uri;
					uri = builder.build();
					HttpGet request = new HttpGet(uri);
					request.addHeader("user-agent", "Collect Earth Java Application");
					HttpResponse response = client.execute(request);
					logger.info("Response http " + response.getStatusLine().getStatusCode());
				} catch (URISyntaxException | IOException e) {
					logger.error("Error generating URL for Analytics", e);
				}

			}
		}.start();

	}
}

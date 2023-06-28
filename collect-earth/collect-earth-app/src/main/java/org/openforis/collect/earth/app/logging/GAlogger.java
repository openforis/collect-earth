package org.openforis.collect.earth.app.logging;

import java.io.IOException;
import java.io.InputStream;
import java.util.Date;

import org.apache.http.HttpEntity;
import org.apache.http.HttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class GAlogger {

	private static final Logger logger = LoggerFactory.getLogger(GAlogger.class);
	private static final String API_SECRET = "E11gVKqxSamFWwCswJPKIQ";
	private static final String MEASUREMENT_ID = "G-8K943HZKJZ";
	
	public static void logGAnalytics(String event) {
		new Thread("GA logging thread") {

			@Override
			public void run() {
				try( CloseableHttpClient httpclient = HttpClients.createDefault() ) {
					// Following instruction from https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?hl=en&client_type=gtag
					HttpPost httppost = new HttpPost("https://www.google-analytics.com/mp/collect?api_secret="+API_SECRET+"&measurement_id="+ MEASUREMENT_ID);
					//  See https://ga-dev-tools.google/ga4/event-builder/?p=2&d=0&f=1&c=custom_event&j=PlotSaved&n=CollectEarth&k=E11gVKqxSamFWwCswJPKIQ&i=G-8K943HZKJZ&e=1687947214291000&m=W10&b=W1tdXQ
					// Request parameters and other properties.
					
					String jsonToSend = "{"
							+ "  \"client_id\": \"CollectEarth\","
							+ "  \"timestamp_micros\": \"" + (new Date() ).getTime() + "\","
							+ "  \"non_personalized_ads\": true,"
							+ "  \"events\": ["
							+ "    {"
							+ "      \"name\": \"" + event + "\"\r\n"
							+ "    }"
							+ "  ]"
							+ "}";

					httppost.addHeader("content-type", "application/json");
					httppost.setEntity( new StringEntity(jsonToSend) );
				    
					//Execute and get the response.
					HttpResponse response = httpclient.execute(httppost);
					HttpEntity entity = response.getEntity();

					if (entity != null) {
					    try (InputStream instream = entity.getContent()) {
					    	int size = 0;
					    	byte[] buffer = new byte[1024];
					    	while ((size = instream.read(buffer)) != -1) System.out.write(buffer, 0, size);
					    }
					}
					
					
					logger.info(event + " GA Logged - Response http " + response.getStatusLine().getStatusCode());
				} catch (IOException e) {
					logger.error("Error generating URL for Analytics", e);
				}

			}
		}.start();

	}
	
}

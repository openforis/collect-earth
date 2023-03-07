package org.openforis.collect.earth.app.logging;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import org.apache.http.HttpEntity;
import org.apache.http.HttpResponse;
import org.apache.http.NameValuePair;
import org.apache.http.client.HttpClient;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.message.BasicNameValuePair;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class GAlogger {

	private static final Logger logger = LoggerFactory.getLogger(GAlogger.class);

	public static void logGAnalytics(String event) {
		new Thread("GA logging thread") {

			@Override
			public void run() {
				try( CloseableHttpClient httpclient = HttpClients.createDefault() ) {
					// Following instruction from https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?hl=en&client_type=gtag
					HttpPost httppost = new HttpPost("https://www.google-analytics.com/mp/collect");
					
					// Request parameters and other properties.
					List<NameValuePair> params = new ArrayList<>(4);
					params.add(new BasicNameValuePair("api_secret", "E11gVKqxSamFWwCswJPKIQ"));
					params.add(new BasicNameValuePair("measurement_id", "G-8K943HZKJZ"));
					params.add(new BasicNameValuePair("client_id", "CollectEarth"));
					params.add(new BasicNameValuePair(
							"events", 
							"[{\"name\": \"" + event +"\",\"params\": {\"engagement_time_msec\": \"100\",\"session_id\": \""  + ( new Date() ).getTime() + "\"} }]"
							)
					);
					httppost.setEntity(new UrlEncodedFormEntity(params, "UTF-8"));
					httppost.addHeader("content-type", "application/x-www-form-urlencoded");

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

package org.openforis.collect.earth.app.logging;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.openforis.collect.earth.app.service.UpdateIniUtils;
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
					//  See https://ga-dev-tools.google/ga4/event-builder/?p=2&d=0&f=1&c=custom_event&j=PlotSaved&n=CollectEarth&k=E11gVKqxSamFWwCswJPKIQ&i=G-8K943HZKJZ&e=1687947214291000&m=W10&b=W1tdXQ
					// Request parameters and other properties.
					
					URL url = new URL ("https://www.google-analytics.com/mp/collect?api_secret="+API_SECRET+"&measurement_id="+ MEASUREMENT_ID);
					HttpURLConnection con = (HttpURLConnection)url.openConnection();
					con.setRequestMethod("POST");
					con.setRequestProperty("Content-Type", "application/json");
					con.setRequestProperty("Accept", "application/json");
					con.setDoOutput(true);
										
					String jsonToSend = "{"
							+ "\"client_id\":\"CollectEarth\","
							+ "\"non_personalized_ads\":true,"
							+ "\"events\":["
							+ "{"
							+ "\"name\":\"" + event + "\","
							+ "\"params\":{"
							+ "\"items\": [],"
							+ "\"version\": \""+ UpdateIniUtils.getVersionInstalled()+"\""
							+ "}"
							+ "}"
							+ "]"
							+ "}";
					
					try(OutputStream os = con.getOutputStream()) {
					    byte[] input = jsonToSend.getBytes("utf-8");
					    os.write(input, 0, input.length);			
					}
					try(BufferedReader br = new BufferedReader( new InputStreamReader(con.getInputStream(), "utf-8")) ) {
					    StringBuilder response = new StringBuilder();
					    String responseLine = null;
					    while ((responseLine = br.readLine()) != null) {
					        response.append(responseLine.trim());
					    }
					    System.out.println(response.toString());
					}
										
					logger.info(event + " GA Logged - Response http " + con.getResponseCode() );
				} catch (IOException e) {
					logger.error("Error generating URL for Analytics", e);
				}

			}
		}.start();

	}
	
}

package org.openforis.collect.earth.app.logging;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.UpdateIniUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

/**
 * Usage analytics, anonymous: a random id of the installation and the version.
 */
public class GAlogger {

	private static final Logger logger = LoggerFactory.getLogger(GAlogger.class);
	// Placeholder left in earth.properties when the installer was built without a ga_api_secret
	private static final String API_SECRET_TOKEN = "GA_API_SECRET";
	private static final String MEASUREMENT_ID = "G-LRHVV8FNZB";
	private static String clientId;

	public static void logGAnalytics(String event) {
		new Thread("GA logging thread") {

			@Override
			public void run() {
				final LocalPropertiesService props = EarthApp.getLocalProperties();
				final String apiSecret = getApiSecret(props);
				if( apiSecret == null ) {
					logger.debug("Analytics are disabled : there is no ga_api_secret in the properties");
					return;
				}

				try {
					// Following instruction from https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?hl=en&client_type=gtag
					URL url = new URL ("https://www.google-analytics.com/mp/collect?api_secret="+apiSecret+"&measurement_id="+ MEASUREMENT_ID);
					HttpURLConnection con = (HttpURLConnection)url.openConnection();
					con.setRequestMethod("POST");
					con.setRequestProperty("Content-Type", "application/json");
					con.setRequestProperty("Accept", "application/json");
					con.setDoOutput(true);

					JsonObject params = new JsonObject();
					params.addProperty("version", UpdateIniUtils.getVersionReleaseDateInstalled());
					JsonObject eventJson = new JsonObject();
					eventJson.addProperty("name", event);
					eventJson.add("params", params);
					JsonArray events = new JsonArray();
					events.add(eventJson);
					JsonObject json = new JsonObject();
					json.addProperty("client_id", getClientId(props));
					json.addProperty("non_personalized_ads", true);
					json.add("events", events);

					try(OutputStream os = con.getOutputStream()) {
						os.write(json.toString().getBytes(StandardCharsets.UTF_8));
					}

					logger.info(event + " GA Logged - Response http " + con.getResponseCode() );
				} catch (IOException e) {
					// warn, not error : the Sentry appender is bound at ERROR, and analytics failing to send is not a
					// defect in Collect Earth. A read timeout to google-analytics.com on a slow connection was among
					// the most frequent errors reported, ahead of anything an interpreter could act on.
					logger.warn("Analytics could not be sent : {}", e.getMessage()); //$NON-NLS-1$
				}

			}

			/**
			 * The secret is not kept in the source code ( this is a public repository ). It is injected into earth.properties
			 * when the installer is built, from the ga_api_secret property of the Maven settings.
			 * @return The secret, or null when the build did not provide one
			 */
			private String getApiSecret(LocalPropertiesService props) {
				String secret = props.getGaApiSecret();
				if( secret == null ) {
					return null;
				}
				secret = secret.trim();
				// Not replaced when building : the placeholder itself, or a Maven property that was never defined
				if( secret.isEmpty() || secret.equals(API_SECRET_TOKEN) || secret.startsWith("${") ) {
					return null;
				}
				return secret;
			}
		}.start();

	}

	private static synchronized String getClientId(LocalPropertiesService props) {
		if( clientId == null ) {
			try {
				clientId = props.getGaClientId();
			} catch (RuntimeException e) {
				logger.warn("The analytics id could not be kept : {}", e.getMessage());
				clientId = UUID.randomUUID().toString();
			}
		}
		return clientId;
	}

}

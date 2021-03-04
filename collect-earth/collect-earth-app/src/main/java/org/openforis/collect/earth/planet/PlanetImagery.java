package org.openforis.collect.earth.planet;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.Security;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Base64;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;

import org.apache.commons.lang3.ArrayUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.TrustAllCertificates;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

public class PlanetImagery {

	private static final Logger logger = LoggerFactory.getLogger(PlanetImagery.class);
	private static final Gson gson = new GsonBuilder().setDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").create();
	private static final SSLSocketFactory factory = getSSLAcceptAllFactory();

	private String apiKey;

	private int retries = 0;

	private static final int MAX_IMAGES_IN_LAYER = 5;
	private static final int MAX_RETRIES = 6;

	public PlanetImagery(String apiKey) {
		super();
		this.apiKey = apiKey;
	}

	private Filter<FilterConfig> getDateFilter(Date start, Date end) {
		Filter<FilterConfig> dateFilter = new Filter<FilterConfig>();
		dateFilter.setType(FilterType.DATERANGE);
		dateFilter.setFieldName(PlanetAttributes.ACQUIRED);
		dateFilter.setConfig(new FilterConfig(new DatePlanet(start), new DatePlanet(end)));
		return dateFilter;
	}

	private Filter<FilterConfig> withinDaysFilter(Feature feature, int days) {
		Date acquriredDate = feature.getProperties().getAcquired();
		LocalDateTime localDateTime = DateUtils.asLocalDateTime(acquriredDate);
		Date start = DateUtils.asDate(localDateTime.minusDays(days));
		Date end = DateUtils.asDate(localDateTime.plusDays(days - 1));
		return getDateFilter(start, end);
	}

	private Filter<FilterConfig> getGeometryFilter(GeoJson geoJson) {
		Filter<FilterConfig> geoFilter = new Filter<FilterConfig>();
		geoFilter.setType(FilterType.GEOMETRY);
		geoFilter.setFieldName(PlanetAttributes.GEOMETRY);
		geoFilter.setConfig(new FilterConfig(geoJson.getType(), geoJson.getCoordinates()));
		return geoFilter;
	}

	private Filter<Filter[]> getAndFilter(Filter[] filters) {
		Filter<Filter[]> andFilter = new Filter<>();
		andFilter.setType(FilterType.AND);
		andFilter.setConfig(filters);
		return andFilter;
	}

	private Filter<String[]> getStringInFilter(String fieldName, String[] strings) {
		Filter<String[]> stringInFilter = new Filter<String[]>();
		stringInFilter.setType(FilterType.STRING_IN);
		stringInFilter.setFieldName(fieldName);
		stringInFilter.setConfig(strings);
		return stringInFilter;
	}

	private int getQuality(Feature feature) {
		FeatureProperties p = feature.getProperties();
		Integer quality = p.getClearPercent();

		if (quality != null)
			return quality;
		else {
			return (int) ((1 - p.getCloudCover()) * 50);
		}
	}

	private String sendRequest(URL url, Object jsonObject) throws IOException {
		try {
			byte[] postDataBytes = null;
			if (jsonObject != null) {
				String jsonInputString = gson.toJson(jsonObject);
				postDataBytes = jsonInputString.getBytes("UTF-8");
				logger.info(jsonInputString);
			}

			HttpURLConnection conn = null;
			if( factory != null ) { // THIS IS A WORKAROUND TO REMOVE SSL CERTIFICATE ISSUES
				conn = (HttpsURLConnection) url.openConnection();
				((HttpsURLConnection)conn).setSSLSocketFactory(factory);
			}else {
				conn = (HttpURLConnection) url.openConnection();
			}

			// very  important to keep the semicolon at the end
			String basicAuth = "Basic " + new String(Base64.getEncoder().encode((apiKey + ":").getBytes()));
			conn.setRequestProperty("Authorization", basicAuth);

			conn.setRequestMethod(jsonObject != null ? "POST" : "GET");
			conn.setRequestProperty("Content-Type", "application/json");
			conn.setRequestProperty("Accept", "application/json");
			conn.setDoOutput(true);
			if (postDataBytes != null) {
				conn.setRequestProperty("Content-Length", String.valueOf(postDataBytes.length));
				conn.getOutputStream().write(postDataBytes);
			} else {
				conn.setRequestProperty("Content-Length", "0");
			}

			StringBuilder response = null;
			try {
				response = readStream(conn.getInputStream());
			} finally {
				conn.disconnect();
			}
			retries = 0; // reset the counter as it was a success
			return response != null ? response.toString() : null;
		} catch (IOException e) {
			if( e.getMessage()!=null && e.getMessage().contains("429") ) { // This happens when there are too many consecutive requests! Make the user wait a bit and try again!
				try {
					if( retries < MAX_RETRIES ) {
						Thread.sleep( 5000 );
						retries++;
					}else {
						retries = 0;
						throw e;
					}
				} catch (InterruptedException e1) {
					logger.error( "Error waiting for Thread requesting Planet imagery");
				}
				return sendRequest(url, jsonObject);
			}else {
				throw e; // Another type of error throw!
			}
		}
	}

	// Workaround for computers that have trouble accepting Planet's SSL certificates
	private static SSLSocketFactory getSSLAcceptAllFactory(){
		SSLSocketFactory factory = null;
		try {
			Security.getProviders();
			final SSLContext ssl = SSLContext.getInstance("TLSv1");
			ssl.init(null, new TrustManager[] { new TrustAllCertificates() }, null);
			return ssl.getSocketFactory();
		} catch (Exception e) {
			logger.error( "Error obtaining SSL factory when opeining Planet REST URL",e);
		}

		return factory;
	}

	private StringBuilder readStream(InputStream is) throws IOException {
		StringBuilder response = new StringBuilder();
		;
		try (BufferedReader br = new BufferedReader(new InputStreamReader(is, "utf-8"))) {
			String responseLine = null;
			while ((responseLine = br.readLine()) != null) {
				response.append(responseLine.trim());
			}
		}
		return response;
	}

	private Feature[] search(String[] itemTypes, Filter[] filters, Integer maxResults) throws IOException {

		Filter<Filter[]> andFilter = getAndFilter(filters);
		SearchRequest searchRequest = new SearchRequest(itemTypes, andFilter);

		String response = sendRequest(new URL("https://api.planet.com/data/v1/quick-search"), searchRequest);
		System.out.println( response );
		Feature[] featuresInPage = getNextPage(response);

		if (featuresInPage != null) {
			if( maxResults != null ) {
				Arrays.sort(featuresInPage, new FeatureSorter());

				if (featuresInPage.length > maxResults) {
					featuresInPage = ArrayUtils.subarray(featuresInPage, 0, maxResults);
				}
				ArrayUtils.reverse(featuresInPage);
			}
		}

		return featuresInPage;

	}

	private Feature[] getNextPage(String resJson) throws IOException {
		if (StringUtils.isNotBlank(resJson)) {
			Response resp = gson.fromJson(resJson, Response.class);
			Feature[] features = resp.getFeatures();
			Links links = resp.getLinks();
			if (links != null && links.getNext() != null) {
				String nextUrl = links.getNext();
				String res = sendRequest(new URL(nextUrl), null);
				Feature[] nextFeatures = getNextPage(res);
				return ArrayUtils.addAll(features, nextFeatures);
			} else {
				return features;
			}
		} else {
			return new Feature[] {};
		}
	}

	private String getLayers(Feature[] features) throws IOException {
		String layerUrl = "";
		if (features.length > 0) {
			String[] ids = new String[features.length];
			for (int i = 0; i < ids.length; i++) {
				Feature feature = features[i];

				String idSearch = feature.getProperties().getItemType() + ':' + feature.getId();
				ids[i] = idSearch;
			}

			SearchRequest layerRequest = new SearchRequest(ids);
			String layers = sendRequest(new URL("https://tiles0.planet.com/data/v1/layers"), layerRequest);
			LayerResponse layerResponse = gson.fromJson(layers, LayerResponse.class);
			if (layerResponse != null) {
				layerUrl = layerResponse.getTiles()[0];
			}
		}
		return layerUrl;
	}

	public String getLayerUrl(Date start, Date end, double[][][] coords, String[] itemTypes) throws IOException {
		Calendar cal = Calendar.getInstance();
		cal.set(2014, 1,1);

		GeoJson geometry = new GeoJson("Polygon", coords);

		Filter<?> dateFilter = getDateFilter(start, end);
		Filter<?> geometryFilter = getGeometryFilter(geometry);
		Filter<?>[] filters = null;
		if( start.after( cal.getTime() ) ) {
			// Add quality filter only for images after 2014
			Filter<?> stringFilter = getStringInFilter("quality_category", new String[] { "standard" });
			filters = new Filter[] { dateFilter, geometryFilter, stringFilter };
		}else {
			filters = new Filter[] { dateFilter, geometryFilter };
		}

		Feature[] searchResults = search(itemTypes, filters, MAX_IMAGES_IN_LAYER);

		return searchResults!=null ? getLayers(searchResults) : null;
	}

	public Map<String, String> getAvailableDates(Date start, Date end, double[][][] coords, String[] itemTypes) throws IOException {

		Calendar cal = Calendar.getInstance();
		cal.set(2014, 1,1);

		GeoJson geometry = new GeoJson("Polygon", coords);

		Filter<?> dateFilter = getDateFilter(start, end);
		Filter<?> geometryFilter = getGeometryFilter(geometry);
		Filter<?>[] filters = null;
		if( start.after( cal.getTime() ) ) {
			// Add quality filter only for images after 2014
			Filter<?> stringFilter = getStringInFilter("quality_category", new String[] { "standard" });
			filters = new Filter[] { dateFilter, geometryFilter, stringFilter };
		}else {
			filters = new Filter[] { dateFilter, geometryFilter };
		}

		Feature[] searchResults = search(itemTypes, filters, null);

		Map<String, String> monthsAvailable = new HashMap<String, String>();

		if( searchResults != null ) {
			for (Feature feature : searchResults) {
				cal.setTime( feature.getProperties().acquired );
				int year = cal.get( Calendar.YEAR );
				int month = cal.get( Calendar.MONTH ) + 1;
				monthsAvailable.put( year+""+ ( month<10?"0"+month:month ), "true");
			}
		}
		return monthsAvailable;
	}

	public String getLatestUrl(SimplePlacemarkObject placemarkObject) throws IOException {
		LocalDateTime localDateTime = DateUtils.asLocalDateTime(new Date());
		Date start = DateUtils.asDate(localDateTime.minusDays(30));

		List<SimpleCoordinate> shape = placemarkObject.getMultiShape().get(0);

		double[][][] polygon = new double[1][shape.size()][2];
		int i = 0;
		for (SimpleCoordinate simpleCoordinate : shape) {
			polygon[0][i][1] = Double.parseDouble(simpleCoordinate.getLatitude());
			polygon[0][i++][0] = Double.parseDouble(simpleCoordinate.getLongitude());
		}
		String[] itemTypes = { "PSScene3Band", "PSScene4Band" };
		return getLayerUrl(start, new Date(), polygon, itemTypes);
	}
}

package org.openforis.collect.earth.planet;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.UnsupportedEncodingException;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Date;
import java.util.List;

import org.apache.commons.lang3.ArrayUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;


public class PlanetImagery {


	private static final Logger logger = LoggerFactory.getLogger( PlanetImagery.class );
	private static final Gson gson = new GsonBuilder().setDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").create();;

	private String apiKey;


	public PlanetImagery(String apiKey) {
		super();
		this.apiKey = apiKey;
	}


	private Filter<FilterConfig> getDateFilter(Date start, Date end) {

		Filter<FilterConfig> dateFilter = new Filter<FilterConfig>();
		dateFilter.setType( FilterType.DATERANGE);
		dateFilter.setFieldName( PlanetAttributes.ACQUIRED );
		dateFilter.setConfig( new FilterConfig( new DatePlanet(start), new DatePlanet( end ) ) );

		return dateFilter;
	}


	private Filter<FilterConfig> withinDaysFilter( Feature feature, int days) {
		Date acquriredDate = feature.getProperties().getAcquired();
		LocalDateTime localDateTime = DateUtils.asLocalDateTime( acquriredDate );
		Date start = DateUtils.asDate( localDateTime.minusDays(days) );
		Date end = DateUtils.asDate( localDateTime.plusDays(days-1) );
		return getDateFilter(start, end);
	}


	private Filter<FilterConfig> getGeometryFilter( GeoJson geoJson ) {
		Filter<FilterConfig> geoFilter = new Filter<FilterConfig>();
		geoFilter.setType( FilterType.GEOMETRY);
		geoFilter.setFieldName( PlanetAttributes.GEOMETRY );
		geoFilter.setConfig( new FilterConfig( geoJson.getType(), geoJson.getCoordinates()) );
		return geoFilter;
	}

	private Filter<Filter[] > getAndFilter( Filter[] filters ) {
		Filter<Filter[] > andFilter = new Filter<Filter[] >();
		andFilter.setType( FilterType.AND);
		andFilter.setConfig( filters );
		return andFilter;
	}

	private Filter<String[]> getStringInFilter( String fieldName, String[] strings ) {
		Filter<String[] > stringInFilter = new Filter<String[] >();
		stringInFilter.setType( FilterType.STRING_IN);
		stringInFilter.setFieldName( fieldName );
		stringInFilter.setConfig( strings );
		return stringInFilter;
	}

	private int getQuality(Feature feature) {
		FeatureProperties p = feature.getProperties();
		Integer quality = p.getClearPercent();

		if( quality!=null)
			return quality;
		else {
			return (int) ( (1 - p.getCloudCover() ) * 50);
		}
	}
	private String sendRequest( URL url, Object jsonObject ) throws IOException {
		byte[] postDataBytes = null;
		if( jsonObject != null ) {
			String jsonInputString = gson.toJson( jsonObject );
			postDataBytes = jsonInputString.getBytes("UTF-8");
			logger.info( jsonInputString );
		}

		HttpURLConnection conn = (HttpURLConnection)url.openConnection();
		String basicAuth = "Basic " + new String(Base64.getEncoder().encode( ( apiKey +":").getBytes())) ; // very important to keep the semicolon at the end
		conn.setRequestProperty ("Authorization", basicAuth);

		conn.setRequestMethod(jsonObject!=null?"POST":"GET");
		conn.setRequestProperty("Content-Type", "application/json");
		conn.setRequestProperty("Accept", "application/json");
		conn.setDoOutput(true);
		if( postDataBytes != null ) {
			conn.setRequestProperty("Content-Length", String.valueOf(postDataBytes.length));
			conn.getOutputStream().write(postDataBytes);
		}else {
			conn.setRequestProperty("Content-Length", "0");
		}

		StringBuilder response = null;
		try {
			response = readStream(conn.getInputStream());
		} catch (Exception e) {
			StringBuilder errorMessage = readStream(conn.getErrorStream());
			logger.error( "Error from Planet",errorMessage.toString() );
			logger.error("Error connecting to Planet server", e );
		}finally {
			conn.disconnect();
		}
		return response!=null?response.toString():null;
	}


	private StringBuilder readStream(InputStream is) throws IOException, UnsupportedEncodingException {
		StringBuilder response = new StringBuilder();;
		try(BufferedReader br = new BufferedReader( new InputStreamReader(is, "utf-8"))) {	
			String responseLine = null;
			while ((responseLine = br.readLine()) != null) {
				response.append(responseLine.trim());
			}
		}
		return response;
	}

	private Feature[] search( String[] itemTypes, Filter[] filters, Boolean sort ) {

		Filter andFilter  = getAndFilter( filters );
		SearchRequest searchRequest = new  SearchRequest( itemTypes, andFilter);
		Feature[] featuresInPage = null;
		String response;
		try {
			response = sendRequest( new URL("https://api.planet.com/data/v1/quick-search"), searchRequest);
			featuresInPage = getNextPage( response);
		} catch (IOException e) {
			logger.error( "Error searching", e );
		}
		return featuresInPage;

	}

	private Feature[] getNextPage(String resJson) throws MalformedURLException, IOException {
		if( StringUtils.isNotBlank( resJson ) ) {
			Response resp = gson.fromJson(resJson, Response.class );
			Feature[] features = resp.getFeatures();
			Links links = resp.getLinks();
			if( links != null && links.getNext() != null ) {
				String nextUrl = links.getNext();
				String res = sendRequest( new URL(nextUrl), null ) ;
				Feature[]next_features = getNextPage(res);
				return ArrayUtils.addAll(features, next_features);
			}else {
				return features;
			}
		}else
			return new Feature[]{};
	}

	private String getLayers(Feature[] features ) throws IOException {
		String layerUrl = "";
		if( features.length > 0 ) {
			String[] ids = new String[ features.length ];
			for (int i = 0; i < ids.length; i++) {
				Feature feature = features[i];

				String idSearch = feature.getProperties().getItemType()
						+ ':' + feature.getId();
				ids[ i ] = idSearch;
			}

			SearchRequest layerRequest = new SearchRequest(ids);
			String layers = sendRequest( new URL("https://tiles0.planet.com/data/v1/layers"), layerRequest);
			LayerResponse layerResponse = gson.fromJson(layers , LayerResponse.class);
			if( layerResponse != null ) {
				layerUrl = layerResponse.getTiles()[0];
			}
		}
		return layerUrl;
	}


	public String getLayerUrl( Date start, Date end, double[][][] coords, String[] itemTypes ) {
		String layerURL = null;
		try {

			GeoJson geometry = new GeoJson("Polygon",coords);		

			Filter dateFilter = getDateFilter( start, end );
			Filter geometryFilter = getGeometryFilter( geometry );
			Filter stringFilter = getStringInFilter( "quality_category",  new String[] {"standard"} );

			Feature[] searchResults = search(
					itemTypes,
					new Filter[]{
							dateFilter,
							geometryFilter,
							stringFilter
					}, 
					true
					);
			layerURL = getLayers(searchResults );

		} catch (Exception e) {
			logger.error( "Error gettting Planet layer URL", e);
		}
		return layerURL;
	}


	public String getLatestUrl(SimplePlacemarkObject placemarkObject) {
		LocalDateTime localDateTime = DateUtils.asLocalDateTime( new Date() );
		Date start = DateUtils.asDate( localDateTime.minusDays(30) );

		List<SimpleCoordinate> shape = placemarkObject.getMultiShape().get(0);

		double[][][] polygon =new double[1][ shape.size() ][2];
		int i=0;
		for (SimpleCoordinate simpleCoordinate : shape) {
			polygon[0][ i ][ 1 ] =  Double.parseDouble( simpleCoordinate.getLatitude() );
			polygon[0][ i++ ][ 0 ] =  Double.parseDouble( simpleCoordinate.getLongitude() );
		}
		String[] itemTypes = {"PSScene3Band", "PSScene4Band"};
		return getLayerUrl( start, new Date(), polygon, itemTypes );
	}
}

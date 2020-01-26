package org.openforis.collect.earth.planet;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.commons.lang3.ArrayUtils;
import org.apache.commons.lang3.StringUtils;

import com.google.gson.Gson;

public class DailyImagery {

	private static final String PLANET_API_KEY = "";
	private static final Gson gson = new Gson();


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

	private Filter<FilterConfig> getGeometryFilter( String geoJsonString ) {
		GeoJson geoJson = gson.fromJson(geoJsonString, GeoJson.class);
		return getGeometryFilter(geoJson);
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
			return ( (1 - p.getCloudCover() ) * 50);
		}
	}
	private String sendRequest( URL url, SearchRequest searchRequest ) throws IOException {
		String jsonInputString = gson.toJson( searchRequest );
		jsonInputString = "json=" + jsonInputString;

	
     Map<String,Object> params = new LinkedHashMap();
     params.put("json", "jsonInputString");
     StringBuilder postData = new StringBuilder();
     for (Map.Entry<String,Object> param : params.entrySet()) {
         if (postData.length() != 0) postData.append('&');
         postData.append(URLEncoder.encode(param.getKey(), "UTF-8"));
         postData.append('=');
         postData.append(URLEncoder.encode(String.valueOf(param.getValue()), "UTF-8"));
     }
     byte[] postDataBytes = postData.toString().getBytes("UTF-8");

     HttpURLConnection conn = (HttpURLConnection)url.openConnection();
     String basicAuth = "Basic " + new String(Base64.getEncoder().encode( (PLANET_API_KEY +":").getBytes())) ;
     conn.setRequestProperty ("Authorization", basicAuth);
     conn.setRequestMethod("POST");
     
     conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
     conn.setRequestProperty("Content-Length", String.valueOf(postDataBytes.length));
     conn.setDoOutput(true);
     conn.getOutputStream().write(postDataBytes);
     StringBuilder response = null;
     try(BufferedReader br = new BufferedReader( new InputStreamReader(conn.getInputStream(), "utf-8"))) {

			response = new StringBuilder();
			String responseLine = null;
			while ((responseLine = br.readLine()) != null) {
				response.append(responseLine.trim());
			}
		}
     return response!=null?response.toString():null;
	}
	/*
	private String sendRequest( URL url, SearchRequest searchRequest ) throws IOException {
		String jsonInputString = gson.toJson( searchRequest );
		jsonInputString = "json=" + jsonInputString;

		HttpURLConnection con= null;
		StringBuilder response = null;
		try {
			con = (HttpURLConnection)url.openConnection();
			String encoded = Base64.getEncoder().encodeToString((PLANET_API_KEY).getBytes(StandardCharsets.UTF_8));  //Java 8
			con.setRequestProperty("Authorization", "Basic "+encoded);
			con.setRequestMethod("POST");
			con.setRequestProperty("Content-Type", "application/json; utf-8");
			con.setRequestProperty("Accept", "application/json");
			con.setDoOutput(true);
			try(OutputStream os = con.getOutputStream()) {
				byte[] input = jsonInputString.getBytes("utf-8");
				os.write(input, 0, input.length);           
			}

			if (con.getResponseCode() == 200) {

				try(BufferedReader br = new BufferedReader( new InputStreamReader(con.getInputStream(), "utf-8"))) {

					response = new StringBuilder();
					String responseLine = null;
					while ((responseLine = br.readLine()) != null) {
						response.append(responseLine.trim());
					}
				}
			}
		}finally {
			if( con != null )
				con.disconnect();
		}
		return response!=null?response.toString():null;
	}
	*/

	private Feature[] search( String[] itemTypes, Filter[] filters, Boolean sort ) {

		Filter andFilter  = getAndFilter( filters );
		SearchRequest searchRequest = new  SearchRequest( itemTypes, andFilter);
		Feature[] featuresInPage = null;
		String response;
		try {
			response = sendRequest( new URL("https://api.planet.com/data/v1/quick-search"), searchRequest);
			featuresInPage = getNextPage( response);
		} catch (IOException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}
		return featuresInPage;

	}

	private Feature[] getNextPage(String res_json) throws MalformedURLException, IOException {

		if( StringUtils.isNotBlank( res_json ) ) {
			Response resp = gson.fromJson(res_json, Response.class );
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

		String url = "https://tiles0.planet.com/data/v1/layers/" + layerResponse.getName() + "/{z}/{x}/{y}.png";
		return url;
	}


	public static void main(String[] args) {
		try {
			
		    System.setProperty("http.proxyHost", "127.0.0.1");
		    System.setProperty("https.proxyHost", "127.0.0.1");
		    System.setProperty("http.proxyPort", "8888");
		    System.setProperty("https.proxyPort", "8888");
		    
			DailyImagery dailyImagery = new DailyImagery();
			SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd");
			Date start;

			start = formatter.parse("2019-11-01");

			Date end =  formatter.parse("2019-12-01");
			String[] item_types = {"PSScene3Band", "PSScene4Band"};
			double[][][] coords = {{
				{
					-1.8230438232421875,
					5.66433079911972
				},
				{
					-1.8195247650146482,
					5.66433079911972
				},
				{
					-1.8195247650146482,
					5.6671493748802915
				},
				{
					-1.8230438232421875,
					5.6671493748802915
				},
				{
					-1.8230438232421875,
					5.66433079911972
				}  }
			};
			GeoJson geometry = new GeoJson("Polygon",coords);		

			Filter dateFilter = dailyImagery.getDateFilter( start, end );
			Filter geometryFilter = dailyImagery.getGeometryFilter( geometry );
			Filter stringFilter = dailyImagery.getStringInFilter( "quality_category",  new String[] {"standard"} );

			System.out.println(
					dailyImagery.search(
							item_types,
							new Filter[]{
									dateFilter,
									geometryFilter,
									stringFilter
							}, 
							true
							)
					);

		} catch (Exception e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}

	}
}

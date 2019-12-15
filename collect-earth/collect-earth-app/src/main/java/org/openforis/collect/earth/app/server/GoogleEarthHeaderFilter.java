package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.FilterConfig;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletRequestWrapper;
import javax.servlet.http.HttpServletResponse;

import org.eclipse.jetty.http.HttpHeader;
import org.openforis.collect.earth.app.EarthConstants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class GoogleEarthHeaderFilter implements Filter{

	final SimpleDateFormat dateFormat = new SimpleDateFormat(EarthConstants.DATE_FORMAT_HTTP, Locale.ENGLISH );
	Logger logger = LoggerFactory.getLogger(GoogleEarthHeaderFilter.class );
		
	@Override
	public void init(FilterConfig filterConfig) throws ServletException {
	}

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
			throws IOException, ServletException {
	       
	        chain.doFilter(new HttpServletRequestWrapper( (HttpServletRequest) request) {
	        	@Override
	        	public long getDateHeader(String name){
	                if(name.equals(HttpHeader.IF_MODIFIED_SINCE.toString() )){
	                	Date now = new Date();
	                	return now.getTime();
	                }else
	                	return super.getDateHeader(name);
	            }
	        	
	        	@Override
	        	public String getHeader(String name) {
	        		 if(name!=null && name.equals("Origin") &&  (super.getHeader("Origin")==null || super.getHeader("Origin").equals("null")) ){
		                	return "*";
		             }else
		               	return super.getHeader(name);
	        	}
	        }, response
	       );
	        
	       
	        
	       ((HttpServletResponse) response).setHeader("Access-Control-Allow-Origin" , "*");
	       ((HttpServletResponse) response).setHeader("Access-Control-Allow-Methods" , "GET, POST, PATCH, PUT, DELETE, OPTIONS");
	       ((HttpServletResponse) response).setHeader("Access-Control-Allow-Headers" , "Origin, Content-Type, X-Auth-Token");
	       
	       logger.debug( "Added Acces control origin to " + ( ( HttpServletRequest)request).getRequestURI() );
		
	}

	@Override
	public void destroy() {
		
	}

}

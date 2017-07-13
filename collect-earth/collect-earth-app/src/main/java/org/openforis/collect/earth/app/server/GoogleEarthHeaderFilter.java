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
import javax.servlet.http.HttpServletResponseWrapper;

import org.eclipse.jetty.http.HttpHeader;
import org.openforis.collect.earth.app.EarthConstants;

public class GoogleEarthHeaderFilter implements Filter{

	final SimpleDateFormat dateFormat = new SimpleDateFormat(EarthConstants.DATE_FORMAT_HTTP, Locale.ENGLISH );
	
	@Override
	public void init(FilterConfig filterConfig) throws ServletException {
		// TODO Auto-generated method stub
	}

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
			throws IOException, ServletException {
	       
	        chain.doFilter(new HttpServletRequestWrapper((HttpServletRequest) request){
	        	@Override
	        	public long getDateHeader(String name){
	                if(name.equals(HttpHeader.IF_MODIFIED_SINCE.toString() )){
	                	Date now = new Date();
	                	return now.getTime();
	                }else
	                	return super.getDateHeader(name);
	            }
	        }, response
	       );
		
	}

	@Override
	public void destroy() {
		// TODO Auto-generated method stub
		
	}

}

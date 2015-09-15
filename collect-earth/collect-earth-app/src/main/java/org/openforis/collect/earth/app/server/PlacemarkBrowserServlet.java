package org.openforis.collect.earth.app.server;

import java.io.IOException;

import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.service.BrowserService;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * Servlet to return the information that is stored in Collect Earth for one placemark (plot)
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Controller
public class PlacemarkBrowserServlet{

	private String lastCoordinates = null;

	@Autowired
	private BrowserService browserService;

	/* 
	 * Returns a JSON object with the data colleted for a placemark in the collect-earth format.
	 * It also opens the extra browser windows for Earth Engine, Timelapse and Bing. 
	 * (non-Javadoc)
	 * @see org.openforis.collect.earth.app.server.JsonPocessorServlet#processRequest(javax.servlet.http.HttpServletRequest, javax.servlet.http.HttpServletResponse)
	 */
	@RequestMapping("/openAuxiliaryWindows")
	protected void openAuxiliaryWindows(HttpServletResponse response, @RequestParam(value = "latLongCoordinates", required = false) final String latLongCoordinates) throws IOException {
		new Thread("Open auxiliary windows"){  //$NON-NLS-1$
			@Override
			public void run() {
				// If this is the first plot or the plot is the last one that was opened
				if( lastCoordinates == null || !lastCoordinates.equals( latLongCoordinates )){
					
						
						openGEEWindow(latLongCoordinates);
						
						openTimeLapseWindow(latLongCoordinates);
						
						openBingMapsWindow(latLongCoordinates);
						
						openGeePlaygroundWindow(latLongCoordinates);
						
						// Until further notice
						// openHereMapsWindow(latLongCoordinates);
					
				}
				
				lastCoordinates = latLongCoordinates;
				
			}

			public void openHereMapsWindow(final String latLongCoordinates) {
				new Thread("Open Here Maps window"){  //$NON-NLS-1$
					@Override
					public void run() {
						try {
								browserService.openHereMaps(latLongCoordinates);
						} catch (final Exception e) {
							LoggerFactory.getLogger(this.getClass()).error("Exception opening Here Maps window", e); //$NON-NLS-1$
							
						}
					}

				}.start();
			}

			public void openGeePlaygroundWindow(final String latLongCoordinates) {
				new Thread("Open GEE Playground window"){  //$NON-NLS-1$
					@Override
					public void run() {
						try {
							browserService.openGeePlayground(latLongCoordinates);
						} catch (final Exception e) {
							LoggerFactory.getLogger(this.getClass()).error("Exception opening Earth Engine Playground window", e); //$NON-NLS-1$
							
						}
					}

				}.start();
			}

			public void openBingMapsWindow(final String latLongCoordinates) {
				new Thread("Open Bing Maps window"){  //$NON-NLS-1$
					@Override
					public void run() {
						try {
							browserService.openBingMaps(latLongCoordinates);
						} catch (final Exception e) {
							LoggerFactory.getLogger(this.getClass()).error("Exception opening Bing Maps window", e); //$NON-NLS-1$
							
						}
					}

				}.start();
			}

			public void openTimeLapseWindow(final String latLongCoordinates) {
				new Thread("Open TimeLapse window"){  //$NON-NLS-1$
					@Override
					public void run() {
						try {
							browserService.openTimelapse(latLongCoordinates);
						} catch (final Exception e) {
							LoggerFactory.getLogger(this.getClass()).error("Exception opening Earth Engine window", e); //$NON-NLS-1$
							
						}
					}

				}.start();
			}

			public void openGEEWindow(final String latLongCoordinates) {
				new Thread("Open GEE window"){  //$NON-NLS-1$
					@Override
					public void run() {
						try {
							browserService.openEarthEngine(latLongCoordinates);
						} catch (final Exception e) {
							LoggerFactory.getLogger(this.getClass()).error("Exception opening Earth Engine window", e); //$NON-NLS-1$
							
						}
					}

				}.start();
			}

		}.start();
	}

}

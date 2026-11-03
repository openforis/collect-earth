package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import org.junit.jupiter.api.Test;

/** The context the server starts with must let the API controllers read and write JSON. */
public class ApplicationContextTemplateTest {

	// The path is relative to the module folder, which Surefire runs the tests in

	@Test
	public void theHandlerAdapterConvertsJson() throws Exception {
		String template = new String(Files.readAllBytes(Paths.get("resources/applicationContext.fmt")), StandardCharsets.UTF_8);
		assertTrue(template.contains("org.springframework.http.converter.json.MappingJackson2HttpMessageConverter"));
		// the converters the adapter had by default stay first, so what the existing controllers answer does not change
		assertTrue(template.indexOf("StringHttpMessageConverter") < template.indexOf("MappingJackson2HttpMessageConverter"));
	}

	@Test
	public void theErrorsOfTheApiAreWrittenAndTheDefaultResolversKept() throws Exception {
		String template = new String(Files.readAllBytes(Paths.get("resources/applicationContext.fmt")), StandardCharsets.UTF_8);
		// declaring one resolver replaces the three the DispatcherServlet has by default, so all three are declared
		int exceptionHandler = template.indexOf("org.springframework.web.servlet.mvc.method.annotation.ExceptionHandlerExceptionResolver");
		int responseStatus = template.indexOf("org.springframework.web.servlet.mvc.annotation.ResponseStatusExceptionResolver");
		int defaultHandler = template.indexOf("org.springframework.web.servlet.mvc.support.DefaultHandlerExceptionResolver");
		assertTrue(exceptionHandler >= 0 && responseStatus > exceptionHandler && defaultHandler > responseStatus);
		// and the first one writes JSON, as the body of ApiExceptionHandler's answers is
		assertTrue(template.indexOf("MappingJackson2HttpMessageConverter", exceptionHandler) < responseStatus);
	}
}

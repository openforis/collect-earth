package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** TemplateWiring must not test less than the server runs without saying so. */
public class TemplateWiringTest {

	@Test
	public void aBeanMissingFromTheTemplateIsNamed(@TempDir Path folder) throws Exception {
		File template = folder.resolve("applicationContext.fmt").toFile();
		Files.write(template.toPath(), ("<beans xmlns=\"http://www.springframework.org/schema/beans\">"
				+ "<bean class=\"org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping\"/>"
				+ "</beans>").getBytes(StandardCharsets.UTF_8));
		IllegalStateException e = assertThrows(IllegalStateException.class, () -> TemplateWiring.mvcBeansOf(template));
		assertTrue(e.getMessage().contains("RequestMappingHandlerAdapter"), e.getMessage());
		assertTrue(e.getMessage().contains("DefaultHandlerExceptionResolver"), e.getMessage());
		assertFalse(e.getMessage().contains("RequestMappingHandlerMapping"), e.getMessage());
	}
}

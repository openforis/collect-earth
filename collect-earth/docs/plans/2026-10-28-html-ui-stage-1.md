# HTML UI, Stage 1 (Foundation) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Collect Earth starts without the Swing main window: the plots map app (or, with the Google Earth Pro viewer,
its home page) is the main window, with an app bar of menus, an operator chip and Quit, backed by a JSON API under
`/earth/api`, and a tray icon to reopen or quit.

**Architecture:** New Spring controllers in `org.openforis.collect.earth.app.server.api` behind `OwnPagesOnlyFilter`
and a header check; a `JobService` for long actions (used from stage 3 on); a native file chooser called through the
API. The React app in `collect-earth-app/src/main/frontend` gets an API client, server texts, a menu model, an app bar
and a home page. The Swing classes stay in the tree (deleted in stage 6) but are no longer created at startup.

**Tech Stack:** Java 11, Spring MVC 5.3 (XML-configured context from `resources/applicationContext.fmt`), Jackson,
JUnit 5 + spring-test MockMvc + Mockito, AWT `SystemTray`; React 19 + MUI 9 + Vite + Vitest.

**Design:** `docs/plans/2026-10-28-html-ui-design.md`. One change from it, decided while planning: no token. The API
is protected the way `/googleEarthWeb/*` already is (`OwnPagesOnlyFilter`: `Sec-Fetch-Site`, `Origin`, `Host`), plus a
required `X-Collect-Earth: 1` header, which a page of another site cannot send without a CORS preflight that the
`cross-origin` filter refuses (it allows only `X-Requested-With, Content-Type, Accept, Origin`).

**Conventions (read before starting):**
- Build with Java 17+ for Maven itself (frontend-maven-plugin needs it): in PowerShell
  `$env:JAVA_HOME='C:\opt\jdk-23.0.2'`. Code still targets release 11.
- Module tests: from `collect-earth-app`, `mvn -q test "-Dskip.npm" "-Dtest=ClassName"`.
- Frontend tests: from `collect-earth-app/src/main/frontend`, `npx vitest run src/path.test.ts`; typecheck
  `npx tsc --noEmit`.
- Comments in this codebase explain *why*, in full sentences, as in `OwnPagesOnlyFilter`. Match it.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `C=collect-earth-app/src/main/java/org/openforis/collect/earth/app`, `T=collect-earth-app/src/test/java/org/openforis/collect/earth/app`,
  `F=collect-earth-app/src/main/frontend/src`.

---

### Task 1: Test dependencies

**Files:** Modify `collect-earth-app/pom.xml` (next to the `junit-jupiter` test dependency, ~line 206).

**Step 1:** Add, both `<scope>test</scope>`:

```xml
<dependency>
	<groupId>org.springframework</groupId>
	<artifactId>spring-test</artifactId>
	<scope>test</scope>
</dependency>
<dependency>
	<groupId>org.mockito</groupId>
	<artifactId>mockito-core</artifactId>
	<version>5.14.2</version>
	<scope>test</scope>
</dependency>
```

`spring-test` takes its version from `spring-framework-bom` in the parent pom.

**Step 2:** `mvn -q test-compile "-Dskip.npm"` from `collect-earth-app`. Expected: exit 0.

**Step 3:** Commit `Test dependencies for the HTML UI API: spring-test (MockMvc) and Mockito`.

---

### Task 2: JSON in and out of controllers

`applicationContext.fmt` declares a bare `RequestMappingHandlerAdapter`, whose converters have no Jackson: that is why
the existing controllers write JSON with their own `ObjectMapper`. The API needs `@RequestBody`/`@ResponseBody`.

**Files:**
- Modify: `collect-earth-app/resources/applicationContext.fmt` (the `RequestMappingHandlerAdapter` bean)
- Test: `$T/server/api/ApplicationContextTemplateTest.java`

**Step 1: Failing test**

```java
package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import org.junit.jupiter.api.Test;

/** The context the server starts with must let the API controllers read and write JSON. */
public class ApplicationContextTemplateTest {

	@Test
	public void theHandlerAdapterConvertsJson() throws Exception {
		String template = new String(Files.readAllBytes(Paths.get("resources/applicationContext.fmt")), StandardCharsets.UTF_8);
		assertTrue(template.contains("org.springframework.http.converter.json.MappingJackson2HttpMessageConverter"));
		// the converters the adapter had by default stay first, so what the existing controllers answer does not change
		assertTrue(template.indexOf("StringHttpMessageConverter") < template.indexOf("MappingJackson2HttpMessageConverter"));
	}
}
```

**Step 2:** Run `mvn -q test "-Dskip.npm" "-Dtest=ApplicationContextTemplateTest"`. Expected: FAIL.

**Step 3:** Replace `<bean class="org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter" />` with:

```xml
<!-- The converters the adapter has by default, then JSON for the controllers of /api (server.api) -->
<bean class="org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter">
	<property name="messageConverters">
		<list>
			<bean class="org.springframework.http.converter.ByteArrayHttpMessageConverter" />
			<bean class="org.springframework.http.converter.StringHttpMessageConverter" />
			<bean class="org.springframework.http.converter.xml.SourceHttpMessageConverter" />
			<bean class="org.springframework.http.converter.support.AllEncompassingFormHttpMessageConverter" />
			<bean class="org.springframework.http.converter.json.MappingJackson2HttpMessageConverter" />
		</list>
	</property>
</bean>
```

**Step 4:** Run the test. Expected: PASS.

**Step 5:** Commit `The API controllers can read and write JSON`.

---

### Task 3: Only Collect Earth's pages may call the API

**Files:**
- Create: `$C/server/api/ApiHeaderFilter.java`
- Modify: `collect-earth-app/src/main/resources/WEB-INF/web.xml`
- Test: `$T/server/api/ApiHeaderFilterTest.java`

**Step 1: Failing test**

```java
package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

public class ApiHeaderFilterTest {

	@Test
	public void onlyRequestsWithTheHeaderPass() {
		assertTrue(ApiHeaderFilter.isAllowed("1"));
		assertFalse(ApiHeaderFilter.isAllowed(null));
		assertFalse(ApiHeaderFilter.isAllowed(""));
		assertFalse(ApiHeaderFilter.isAllowed("0"));
	}
}
```

**Step 2:** Run. Expected: FAIL (no class).

**Step 3: Implementation**

```java
package org.openforis.collect.earth.app.server.api;

import java.io.IOException;

import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/**
 * Lets through to /api/* only the requests that carry {@code X-Collect-Earth: 1}, as the pages of Collect Earth send
 * (api.ts). A page of another site cannot add that header without a CORS preflight, which the cross-origin filter of
 * web.xml refuses as it allows no such header: with OwnPagesOnlyFilter, mapped before this one, no other page can make
 * Collect Earth export, delete plots or change its settings. A secret token would protect no better, and would have to
 * be handed to the page somehow.
 */
public class ApiHeaderFilter implements Filter {

	static final String HEADER = "X-Collect-Earth";

	static boolean isAllowed(String header) {
		return "1".equals(header);
	}

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
			throws IOException, ServletException {
		if (!isAllowed(((HttpServletRequest) request).getHeader(HEADER))) {
			((HttpServletResponse) response).sendError(HttpServletResponse.SC_FORBIDDEN);
			return;
		}
		chain.doFilter(request, response);
	}
}
```

**Step 4:** In `web.xml`, declare the filter next to `ownPagesOnlyFilter`, add `<url-pattern>/api/*</url-pattern>` to the
`ownPagesOnlyFilter` mapping, and map `apiHeaderFilter` to `/api/*` right after it (before `localizationFilter`):

```xml
<!-- The API (server.api) answers only Collect Earth's own pages: see ApiHeaderFilter -->
<filter>
	<filter-name>apiHeaderFilter</filter-name>
	<filter-class>org.openforis.collect.earth.app.server.api.ApiHeaderFilter</filter-class>
</filter>
...
<filter-mapping>
	<filter-name>apiHeaderFilter</filter-name>
	<url-pattern>/api/*</url-pattern>
</filter-mapping>
```

Update the `OwnPagesOnlyFilter` class comment: it now also guards `/api/*`.

**Step 5:** Run the test. Expected: PASS. Also `-Dtest=OwnPagesOnlyFilterTest` if it exists: still PASS.

**Step 6:** Commit `Only Collect Earth's own pages may call the API`.

---

### Task 4: Errors as JSON

**Files:**
- Create: `$C/server/api/ApiException.java`, `$C/server/api/ApiExceptionHandler.java`
- Test: `$T/server/api/ApiExceptionHandlerTest.java`

**Step 1: Failing test** (a throwaway controller in the test)

```java
package org.openforis.collect.earth.app.server.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

public class ApiExceptionHandlerTest {

	@RestController
	static class Failing {
		@GetMapping("/api/expected")
		public String expected() {
			throw new ApiException("project.unreadable", "The project file cannot be read");
		}

		@GetMapping("/api/unexpected")
		public String unexpected() {
			throw new IllegalStateException("boom");
		}
	}

	private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new Failing())
			.setControllerAdvice(new ApiExceptionHandler()).build();

	@Test
	public void anExpectedProblemSaysWhatItIs() throws Exception {
		mvc.perform(get("/api/expected")).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("project.unreadable"))
				.andExpect(jsonPath("$.message").value("The project file cannot be read"));
	}

	@Test
	public void anUnexpectedOneIsAnInternalError() throws Exception {
		mvc.perform(get("/api/unexpected")).andExpect(status().isInternalServerError())
				.andExpect(jsonPath("$.error").value("internal"))
				.andExpect(jsonPath("$.details").value("boom"));
	}
}
```

**Step 2:** Run. Expected: FAIL (classes missing).

**Step 3: Implementation**

```java
package org.openforis.collect.earth.app.server.api;

/** A problem the user can do something about: answered 400 with its code and message (see ApiExceptionHandler). */
public class ApiException extends RuntimeException {

	private static final long serialVersionUID = 1L;
	private final String code;

	public ApiException(String code, String message) {
		super(message);
		this.code = code;
	}

	public String getCode() {
		return code;
	}
}
```

```java
package org.openforis.collect.earth.app.server.api;

import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

/**
 * The errors of the API as {@code {error, message, details}}, which the pages show (api.ts): an ApiException is a
 * problem the user can act on, anything else a fault, logged (and so sent to Sentry, as every error of the log is).
 */
@ControllerAdvice(basePackageClasses = ApiExceptionHandler.class)
public class ApiExceptionHandler {

	private final Logger logger = LoggerFactory.getLogger(ApiExceptionHandler.class);

	@ExceptionHandler(ApiException.class)
	public ResponseEntity<Map<String, String>> expected(ApiException e) {
		return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body(e.getCode(), e.getMessage(), null));
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<Map<String, String>> unexpected(Exception e) {
		logger.error("The API failed", e);
		return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body("internal", null, e.getMessage()));
	}

	private static Map<String, String> body(String error, String message, String details) {
		Map<String, String> body = new LinkedHashMap<>();
		body.put("error", error);
		body.put("message", message);
		body.put("details", details);
		return body;
	}
}
```

Note: at runtime the `ExceptionHandlerExceptionResolver` is the DispatcherServlet's default one, whose converters
have no Jackson. **Check it in Task 18's manual run**; if errors come back empty, declare in `applicationContext.fmt`
an `ExceptionHandlerExceptionResolver` bean with the same `messageConverters` list as Task 2.

**Step 4:** Run. Expected: PASS.

**Step 5:** Commit `API errors answer {error, message, details}`.

---

### Task 5: `GET /api/app` and the operator

**Files:**
- Create: `$C/server/api/AppInfoController.java`
- Test: `$T/server/api/AppInfoControllerTest.java`

**Step 1: Failing test**

```java
package org.openforis.collect.earth.app.server.api;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.LocalPropertiesService.UI_LANGUAGE;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

public class AppInfoControllerTest {

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final AppInfoController controller = new AppInfoController(properties, () -> "Sierra Leone 2026");
	private final MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
			.setControllerAdvice(new ApiExceptionHandler()).build();

	@Test
	public void saysWhatTheAppBarShows() throws Exception {
		when(properties.getOperator()).thenReturn("alfonso");
		when(properties.getUiLanguage()).thenReturn(UI_LANGUAGE.ES);
		when(properties.getValue(EarthProperty.VIEWER_TYPE)).thenReturn("google_earth_web");
		when(properties.isPlotsMapViewer()).thenReturn(true);
		mvc.perform(get("/api/app")).andExpect(status().isOk())
				.andExpect(jsonPath("$.project").value("Sierra Leone 2026"))
				.andExpect(jsonPath("$.operator").value("alfonso"))
				.andExpect(jsonPath("$.language").value("es"))
				.andExpect(jsonPath("$.viewer").value("google_earth_web"))
				.andExpect(jsonPath("$.plotsMap").value(true));
	}

	@Test
	public void theOperatorIsSaved() throws Exception {
		mvc.perform(put("/api/app/operator").contentType(MediaType.APPLICATION_JSON).content("{\"operator\":\"  maria.k  \"}"))
				.andExpect(status().isOk());
		verify(properties).saveOperator("maria.k");
	}

	@Test
	public void anOperatorNameOfFiveCharactersOrLessIsRefused() throws Exception {
		// CollectEarthWindow.33: longer than 5 characters and shorter than 50
		mvc.perform(put("/api/app/operator").contentType(MediaType.APPLICATION_JSON).content("{\"operator\":\"ana\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("operator.length"));
		verify(properties, never()).saveOperator("ana");
	}
}
```

Check `UI_LANGUAGE`'s constant name for Spanish in `LocalPropertiesService` (around line 402) and adjust `ES` if it differs.

**Step 2:** Run. Expected: FAIL.

**Step 3: Implementation**

```java
package org.openforis.collect.earth.app.server.api;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.UpdateIniUtils;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** What the app bar and the home page show (app.ts), and the operator they let the user change. */
@RestController
public class AppInfoController {

	private final LocalPropertiesService properties;
	/** The project name, from the survey: a supplier, as the survey changes when another project is loaded */
	private final Supplier<String> projectName;

	@Autowired
	public AppInfoController(LocalPropertiesService properties, EarthSurveyService surveys) {
		this(properties, () -> surveys.getCollectSurvey() == null ? null : surveys.getCollectSurvey().getProjectName());
	}

	AppInfoController(LocalPropertiesService properties, Supplier<String> projectName) {
		this.properties = properties;
		this.projectName = projectName;
	}

	@GetMapping("/api/app")
	public Map<String, Object> app() {
		Map<String, Object> app = new LinkedHashMap<>();
		app.put("project", projectName.get());
		app.put("operator", properties.getOperator());
		app.put("language", properties.getUiLanguage().getLocale().getLanguage());
		app.put("viewer", properties.getValue(EarthProperty.VIEWER_TYPE));
		app.put("plotsMap", properties.isPlotsMapViewer());
		app.put("version", UpdateIniUtils.getVersionNameInstalled());
		return app;
	}

	@PutMapping("/api/app/operator")
	public void operator(@RequestBody Map<String, String> body) {
		String operator = body.get("operator") == null ? "" : body.get("operator").trim();
		// The rule of the Swing main window (CollectEarthWindow.33)
		if (operator.length() <= 5 || operator.length() >= 50) {
			throw new ApiException("operator.length", Messages.getString("CollectEarthWindow.33"));
		}
		properties.saveOperator(operator);
	}
}
```

If `UpdateIniUtils.getVersionNameInstalled()` throws in a test JVM (it reads `update.ini` next to the app), wrap it:
return null on any exception, and log at debug.

**Step 4:** Run. Expected: PASS.

**Step 5:** Commit `GET /api/app and PUT /api/app/operator`.

---

### Task 6: `GET /api/messages?lang=`

**Files:**
- Create: `$C/server/api/MessagesController.java`
- Test: `$T/server/api/MessagesControllerTest.java`

**Step 1: Failing test**

```java
package org.openforis.collect.earth.app.server.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

public class MessagesControllerTest {

	private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new MessagesController()).build();

	@Test
	public void givesTheTextsOfTheLanguage() throws Exception {
		mvc.perform(get("/api/messages").param("lang", "es"))
				.andExpect(jsonPath("$.language").value("es"))
				.andExpect(jsonPath("$.texts['CollectEarthMenu.0']").value(org.hamcrest.Matchers.not("Import CEP file")))
				.andExpect(jsonPath("$.texts['CollectEarthWindow.11']").exists());
	}

	@Test
	public void anUnknownLanguageGetsEnglish() throws Exception {
		mvc.perform(get("/api/messages").param("lang", "xx"))
				.andExpect(jsonPath("$.texts['CollectEarthMenu.0']").value("Import CEP file"));
	}
}
```

(`CollectEarthMenu.0` must be translated in `Messages_es.properties`; if not, pick a key that is.)

**Step 2:** Run. Expected: FAIL.

**Step 3: Implementation**

```java
package org.openforis.collect.earth.app.server.api;

import java.util.Locale;
import java.util.Map;
import java.util.ResourceBundle;
import java.util.TreeMap;

import org.openforis.collect.earth.app.view.Messages;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The texts of the Swing UI (Messages*.properties) for the pages: they keep their nine translations, and are not
 * translated a second time in the frontend. Read for the language asked for, not the one Messages is set to, so a
 * page can switch language before the setting is saved. A language with no bundle gets English, as ResourceBundle
 * falls back to the base bundle.
 */
@RestController
public class MessagesController {

	@GetMapping("/api/messages")
	public Map<String, Object> messages(@RequestParam("lang") String lang) {
		// The root locale as fallback, not the default one, which Messages.setLocale sets to the UI language
		ResourceBundle bundle = ResourceBundle.getBundle(Messages.BUNDLE_NAME, Locale.forLanguageTag(lang),
				ResourceBundle.Control.getNoFallbackControl(ResourceBundle.Control.FORMAT_DEFAULT));
		Map<String, String> texts = new TreeMap<>();
		for (String key : bundle.keySet()) {
			texts.put(key, bundle.getString(key));
		}
		Map<String, Object> answer = new TreeMap<>();
		answer.put("language", lang);
		answer.put("texts", texts);
		return answer;
	}
}
```

**Step 4:** Run. Expected: PASS.

**Step 5:** Commit `GET /api/messages: the Swing texts, in any of their languages, for the pages`.

---

### Task 7: `JobService`

**Files:**
- Create: `$C/service/jobs/Job.java`, `$C/service/jobs/JobContext.java`, `$C/service/jobs/JobService.java`
- Test: `$T/service/jobs/JobServiceTest.java`

**Step 1: Failing test**

```java
package org.openforis.collect.earth.app.service.jobs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

public class JobServiceTest {

	private final JobService jobs = new JobService();

	@AfterEach
	public void stop() {
		jobs.shutdown();
	}

	private Map<String, Object> waitUntilOver(String id) throws InterruptedException {
		for (int i = 0; i < 100; i++) {
			Map<String, Object> job = jobs.get(id);
			if (!"RUNNING".equals(job.get("state"))) {
				return job;
			}
			Thread.sleep(50);
		}
		throw new AssertionError("still running");
	}

	@Test
	public void reportsProgressMessagesAndResult() throws Exception {
		String id = jobs.start("export", ctx -> {
			ctx.progress(50, "half way");
			ctx.message("12 records");
			return "C:/out/export.csv";
		});
		Map<String, Object> job = waitUntilOver(id);
		assertEquals("DONE", job.get("state"));
		assertEquals(100, job.get("progress"));
		assertEquals("C:/out/export.csv", job.get("result"));
		assertTrue(((java.util.List<?>) job.get("messages")).contains("12 records"));
	}

	@Test
	public void aFailureKeepsItsMessages() throws Exception {
		String id = jobs.start("export", ctx -> {
			ctx.message("read 3 plots");
			throw new IllegalStateException("disk full");
		});
		Map<String, Object> job = waitUntilOver(id);
		assertEquals("FAILED", job.get("state"));
		assertEquals("disk full", job.get("error"));
		assertTrue(((java.util.List<?>) job.get("messages")).contains("read 3 plots"));
	}

	@Test
	public void canBeCancelled() throws Exception {
		CountDownLatch started = new CountDownLatch(1);
		String id = jobs.start("export", ctx -> {
			started.countDown();
			while (!ctx.isCancelled()) {
				Thread.sleep(10);
			}
			return null;
		});
		assertTrue(started.await(2, TimeUnit.SECONDS));
		jobs.cancel(id);
		assertEquals("CANCELLED", waitUntilOver(id).get("state"));
	}

	@Test
	public void oneJobOfAKindAtATime() throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		jobs.start("export", ctx -> { release.await(); return null; });
		assertThrows(IllegalStateException.class, () -> jobs.start("export", ctx -> null));
		assertNotNull(jobs.start("import", ctx -> null));
		release.countDown();
	}

	@Test
	public void anUnknownJobIsNull() {
		assertNull(jobs.get("nope"));
	}
}
```

**Step 2:** Run. Expected: FAIL.

**Step 3: Implementation**

```java
package org.openforis.collect.earth.app.service.jobs;

/** A long action the pages start and follow (an export, an import...): see JobService. */
@FunctionalInterface
public interface Job {
	/** @return what the page shows when it is done (a file written, a count), or null */
	Object run(JobContext context) throws Exception;
}
```

```java
package org.openforis.collect.earth.app.service.jobs;

/** What a running Job tells its page, and how it learns that the user cancelled it. */
public interface JobContext {
	/** @param percent 0-100, or -1 when it cannot be known */
	void progress(int percent, String step);

	void message(String line);

	boolean isCancelled();
}
```

```java
package org.openforis.collect.earth.app.service.jobs;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import javax.annotation.PreDestroy;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Runs the long actions of the pages (exports, imports, Saiku, IPCC...) on threads of their own and keeps what they
 * report, which the pages read (GET /api/jobs/{id}): the Swing UI blocked in a modal progress dialog instead. One job
 * of each kind at a time, as those dialogs allowed. A job is forgotten FORGET_AFTER_MINUTES after it ended.
 */
@Service
public class JobService {

	static final long FORGET_AFTER_MINUTES = 30;

	private final Logger logger = LoggerFactory.getLogger(JobService.class);
	private final ExecutorService executor = Executors.newCachedThreadPool(r -> {
		Thread t = new Thread(r, "Collect Earth job");
		t.setDaemon(true);
		return t;
	});
	private final Map<String, Running> jobs = new ConcurrentHashMap<>();

	private static final class Running implements JobContext {
		final String kind;
		volatile String state = "RUNNING";
		volatile int progress;
		volatile String step;
		final List<String> messages = Collections.synchronizedList(new ArrayList<>());
		volatile Object result;
		volatile String error;
		volatile boolean cancelled;
		volatile long endedAt;

		Running(String kind) {
			this.kind = kind;
		}

		@Override
		public void progress(int percent, String step) {
			this.progress = percent;
			this.step = step;
		}

		@Override
		public void message(String line) {
			messages.add(line);
		}

		@Override
		public boolean isCancelled() {
			return cancelled;
		}
	}

	/**
	 * @return the id of the job
	 * @throws IllegalStateException when a job of the same kind still runs
	 */
	public synchronized String start(String kind, Job job) {
		forgetOld();
		for (Running running : jobs.values()) {
			if (running.kind.equals(kind) && "RUNNING".equals(running.state)) {
				throw new IllegalStateException("A job of kind " + kind + " is running already");
			}
		}
		String id = UUID.randomUUID().toString();
		Running running = new Running(kind);
		jobs.put(id, running);
		executor.execute(() -> {
			try {
				running.result = job.run(running);
				running.state = running.cancelled ? "CANCELLED" : "DONE";
				if (!running.cancelled) {
					running.progress = 100;
				}
			} catch (InterruptedException e) {
				running.state = "CANCELLED";
				Thread.currentThread().interrupt();
			} catch (Exception e) {
				logger.error("The job {} failed", kind, e);
				running.error = e.getMessage();
				running.state = "FAILED";
			} finally {
				running.endedAt = System.currentTimeMillis();
			}
		});
		return id;
	}

	/** The job as the page reads it, or null when there is none of that id (never, or forgotten). */
	public Map<String, Object> get(String id) {
		Running running = jobs.get(id);
		if (running == null) {
			return null;
		}
		Map<String, Object> job = new LinkedHashMap<>();
		job.put("id", id);
		job.put("kind", running.kind);
		job.put("state", running.state);
		job.put("progress", running.progress);
		job.put("step", running.step);
		synchronized (running.messages) {
			job.put("messages", new ArrayList<>(running.messages));
		}
		job.put("result", running.result);
		job.put("error", running.error);
		return job;
	}

	/** Asks the job to stop: it does at its next check of JobContext.isCancelled(). False when there is no such job. */
	public boolean cancel(String id) {
		Running running = jobs.get(id);
		if (running == null) {
			return false;
		}
		running.cancelled = true;
		return true;
	}

	private void forgetOld() {
		long before = System.currentTimeMillis() - TimeUnit.MINUTES.toMillis(FORGET_AFTER_MINUTES);
		jobs.values().removeIf(job -> job.endedAt != 0 && job.endedAt < before);
	}

	@PreDestroy
	public void shutdown() {
		executor.shutdownNow();
	}
}
```

**Step 4:** Run. Expected: PASS.

**Step 5:** Commit `JobService: the long actions of the pages run on their own threads and report their progress`.

---

### Task 8: `GET` / `DELETE /api/jobs/{id}`

**Files:**
- Create: `$C/server/api/JobsController.java`
- Test: `$T/server/api/JobsControllerTest.java`

**Step 1: Failing test**

```java
package org.openforis.collect.earth.app.server.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.jobs.JobService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

public class JobsControllerTest {

	private final JobService jobs = new JobService();
	private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new JobsController(jobs))
			.setControllerAdvice(new ApiExceptionHandler()).build();

	@AfterEach
	public void stop() {
		jobs.shutdown();
	}

	@Test
	public void aJobIsRead() throws Exception {
		String id = jobs.start("export", ctx -> "done");
		Thread.sleep(200);
		mvc.perform(get("/api/jobs/" + id)).andExpect(jsonPath("$.state").value("DONE"))
				.andExpect(jsonPath("$.result").value("done"));
	}

	@Test
	public void anUnknownJobIsNotFound() throws Exception {
		mvc.perform(get("/api/jobs/nope")).andExpect(status().isNotFound());
		mvc.perform(delete("/api/jobs/nope")).andExpect(status().isNotFound());
	}
}
```

**Step 2:** Run. Expected: FAIL.

**Step 3: Implementation**

```java
package org.openforis.collect.earth.app.server.api;

import java.util.Map;

import org.openforis.collect.earth.app.service.jobs.JobService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** The jobs the pages started (see JobService); each stage adds the POSTs that start them. */
@RestController
public class JobsController {

	private final JobService jobs;

	@Autowired
	public JobsController(JobService jobs) {
		this.jobs = jobs;
	}

	@GetMapping("/api/jobs/{id}")
	public ResponseEntity<Map<String, Object>> job(@PathVariable("id") String id) {
		Map<String, Object> job = jobs.get(id);
		return job == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(job);
	}

	@DeleteMapping("/api/jobs/{id}")
	public ResponseEntity<Void> cancel(@PathVariable("id") String id) {
		return jobs.cancel(id) ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
	}
}
```

**Step 4:** Run. Expected: PASS.

**Step 5:** Commit `GET and DELETE /api/jobs/{id}`.

---

### Task 9: `POST /api/files/choose`

**Files:**
- Create: `$C/service/NativeFileChooser.java` (interface), `$C/service/SwingNativeFileChooser.java`,
  `$C/server/api/FilesController.java`
- Test: `$T/server/api/FilesControllerTest.java`

The chooser is the one place a Swing class stays after stage 6: AWT's `FileDialog` cannot choose folders on Windows.
Existing helpers to reuse: `view/FileChooserUtils`, `view/ShellFolderFallback` (read both first).

**Step 1: Failing test** (the controller with a fake chooser)

```java
package org.openforis.collect.earth.app.server.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.NativeFileChooser;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

public class FilesControllerTest {

	private String askedMode;
	private List<String> askedExtensions;

	private final NativeFileChooser chooser = (mode, extensions, suggested) -> {
		askedMode = mode.name();
		askedExtensions = extensions;
		return "cancel".equals(suggested) ? null : "C:/data/plots.csv";
	};
	private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new FilesController(chooser)).build();

	@Test
	public void aChosenFileIsAnswered() throws Exception {
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON)
				.content("{\"mode\":\"OPEN\",\"extensions\":[\"csv\",\"ced\"]}"))
				.andExpect(jsonPath("$.path").value("C:/data/plots.csv"));
		org.junit.jupiter.api.Assertions.assertEquals("OPEN", askedMode);
		org.junit.jupiter.api.Assertions.assertEquals(List.of("csv", "ced"), askedExtensions);
	}

	@Test
	public void aCancelledDialogSaysSo() throws Exception {
		mvc.perform(post("/api/files/choose").contentType(MediaType.APPLICATION_JSON)
				.content("{\"mode\":\"SAVE\",\"suggested\":\"cancel\"}"))
				.andExpect(jsonPath("$.cancelled").value(true));
	}
}
```

**Step 2:** Run. Expected: FAIL.

**Step 3: Implementation**

```java
package org.openforis.collect.earth.app.service;

import java.util.List;

/** A file dialog of the operating system, shown for a page that needs a path (POST /api/files/choose). */
public interface NativeFileChooser {

	enum Mode { OPEN, SAVE, FOLDER }

	/**
	 * @param extensions the extensions to show (without the dot), empty for all files
	 * @param suggested  the file or folder to start from, or null
	 * @return the absolute path chosen, or null when the user cancelled
	 */
	String choose(Mode mode, List<String> extensions, String suggested);
}
```

```java
package org.openforis.collect.earth.app.server.api;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.app.service.NativeFileChooser;
import org.openforis.collect.earth.app.service.NativeFileChooser.Mode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * A path for a page: a browser can only hand a page the contents of a file, and Collect Earth needs where it is (a
 * project, a CSV of plots, a folder to export to). The server runs on the user's computer, so it shows the dialog.
 */
@RestController
public class FilesController {

	private final NativeFileChooser chooser;

	@Autowired
	public FilesController(NativeFileChooser chooser) {
		this.chooser = chooser;
	}

	public static class Request {
		public Mode mode = Mode.OPEN;
		public List<String> extensions = Collections.emptyList();
		public String suggested;
	}

	@PostMapping("/api/files/choose")
	public Map<String, Object> choose(@RequestBody Request request) {
		String path = chooser.choose(request.mode, request.extensions, request.suggested);
		return path == null ? Collections.singletonMap("cancelled", true) : Collections.singletonMap("path", path);
	}
}
```

`SwingNativeFileChooser` (`@Component`): on the Swing event thread (`SwingUtilities.invokeAndWait`), create an
undecorated, always-on-top, 0×0 `JFrame` at the centre of the screen as the parent (so the dialog comes in front of
the browser windows, which the user is looking at), then a `JFileChooser` set up as `FileChooserUtils` does (reuse it:
`ShellFolderFallback`, the file filter), in `FILES_ONLY` or `DIRECTORIES_ONLY`, `showOpenDialog`/`showSaveDialog`,
dispose of the frame in `finally`. For SAVE, add the first extension when the name has none. Return
`getAbsolutePath()` or null. No unit test (it is a dialog); checked by hand in Task 18.

**Step 4:** Run the test. Expected: PASS.

**Step 5:** Commit `POST /api/files/choose: the operating system's file dialog for the pages`.

---

### Task 10: Quit

**Files:**
- Create: `$C/service/QuitService.java`, `$C/server/api/ActionsController.java`
- Test: `$T/server/api/ActionsControllerTest.java`

**Step 1: Failing test**

```java
package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

public class ActionsControllerTest {

	private final AtomicBoolean quit = new AtomicBoolean();
	private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new ActionsController(() -> quit.set(true)))
			.setControllerAdvice(new ApiExceptionHandler()).build();

	@Test
	public void quitQuits() throws Exception {
		mvc.perform(post("/api/actions/quit")).andExpect(status().isOk());
		assertTrue(quit.get());
	}

	@Test
	public void anUnknownActionIsNotFound() throws Exception {
		mvc.perform(post("/api/actions/fly")).andExpect(status().isNotFound());
	}
}
```

**Step 2:** Run. Expected: FAIL.

**Step 3: Implementation**

`QuitService` (`@Service`, implements `Runnable`): what the Swing window did on closing (`CollectEarthWindow`
windowClosing, ~line 164): on a thread of its own, `EarthApp.quitServer()` on another thread, join it for at most 5 s,
then `System.exit(0)`. Started from a new thread so the HTTP request that asked for it is answered first.

```java
package org.openforis.collect.earth.app.service;

import org.openforis.collect.earth.app.desktop.EarthApp;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** Quits Collect Earth, from the app bar or the tray: the server first, at most 5 s, then the process. */
@Service
public class QuitService implements Runnable {

	private static final long SERVER_STOP_MILLIS = 5000;
	private final Logger logger = LoggerFactory.getLogger(QuitService.class);

	@Override
	public void run() {
		new Thread(() -> {
			Thread stop = new Thread(() -> {
				try {
					EarthApp.quitServer();
				} catch (RuntimeException e) {
					logger.error("Error when stopping the server", e);
				}
			}, "Stopping server");
			stop.start();
			try {
				stop.join(SERVER_STOP_MILLIS);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
			System.exit(0);
		}, "Quitting Collect Earth").start();
	}
}
```

```java
package org.openforis.collect.earth.app.server.api;

import org.openforis.collect.earth.app.service.QuitService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Quick actions of the menus; the later stages add theirs (open the data folder, the log, the manual...). */
@RestController
public class ActionsController {

	private final Runnable quit;

	@Autowired
	public ActionsController(QuitService quit) {
		this((Runnable) quit);
	}

	ActionsController(Runnable quit) {
		this.quit = quit;
	}

	@PostMapping("/api/actions/{name}")
	public ResponseEntity<Void> action(@PathVariable("name") String name) {
		if ("quit".equals(name)) {
			quit.run();
			return ResponseEntity.ok().build();
		}
		return ResponseEntity.notFound().build();
	}
}
```

**Step 4:** Run. Expected: PASS.

**Step 5:** Commit `Quit from the pages: POST /api/actions/quit`.

---

### Task 11: The app page instead of the Swing window, and the tray icon

**Files:**
- Modify: `$C/view/CollectEarthWindow.java` (remove `@Lazy(false)`, ~line 63)
- Create: `$C/desktop/AppShell.java`
- Modify: `$C/service/BrowserService.java` (`leafletMapUrl`, ~line 1443; a new `openHomePage()`)
- Modify: `$C/desktop/EarthApp.java` (`simulateClickKmz`, ~line 931)
- Test: `$T/service/BrowserServiceUrlTest.java` (or the existing test of `leafletMapUrl`: `grep -rn leafletMapUrl $T`)

**Step 1: Failing test** for the home URL:

```java
@Test
public void theHomePageIsTheMapPageWithoutAMap() {
	assertEquals("http://localhost:8028/earth/map?home", BrowserService.homeUrl("http://localhost:8028/earth/"));
}
```

**Step 2:** Run. Expected: FAIL.

**Step 3: Implementation**

- `BrowserService`:
  ```java
  /** The app without a map, for the Google Earth Pro viewer (see App.tsx, IN_HOME) */
  static String homeUrl(String base) {
  	return base + "map?home";
  }
  ```
  and `public void openHomePage()`, which opens that URL in the plots-map window the way `showLeafletMap(null)`
  does (read `showLeafletMap`; extract the URL into a parameter rather than duplicating the method).
- `CollectEarthWindow`: delete `@Lazy(false)` (and its import if unused). The context is `default-lazy-init`, so the
  window, its menu and its transfer handler are no longer created. They are deleted in stage 6.
- `AppShell` (`@Component @Lazy(false)`, `InitializingBean`, `DisposableBean`): on start, set `Messages.setLocale` to
  the UI language (what `CollectEarthWindow.init` did) and, unless `GraphicsEnvironment.isHeadless()` or
  `!SystemTray.isSupported()`, add a `TrayIcon` (image `images/smallOpenForisBanner.png`, tooltip "Collect Earth")
  whose `PopupMenu` has **Open Collect Earth** (`browserService.openLeafletMap()` for the plots-map viewer, else
  `openHomePage()`) and **Quit** (`CollectEarthWindow.42`, calls `QuitService.run()`); a double click opens too. On
  destroy, remove the icon: the context is created again when the server restarts (a project or settings change),
  and each would add one.
- `EarthApp.simulateClickKmz`: in the Google Earth Pro branch, after `openKmlOnGoogleEarth()`, open the home page on a
  thread of its own as `openLeafletMap()` does (`serverController.getContext().getBean(BrowserService.class).openHomePage()`).

**Step 4:** Run the URL test. Expected: PASS. Run all module tests: `mvn -q test "-Dskip.npm"`. Expected: exit 0.

**Step 5:** Commit `Collect Earth opens its pages instead of the Swing window, with a tray icon to reopen or quit`.

---

### Task 12: Frontend API client

**Files:** Create `$F/apiClient.ts`; Test `$F/apiClient.test.ts`.

**Step 1: Failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPost } from "./apiClient";

afterEach(() => vi.unstubAllGlobals());

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("apiClient", () => {
  it("sends the header the server requires", async () => {
    const fetchMock = answer(200, { ok: 1 });
    vi.stubGlobal("fetch", fetchMock);
    await apiGet("app");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Collect-Earth"]).toBe("1");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/earth\/api\/app$/);
  });

  it("posts JSON and returns the answer", async () => {
    vi.stubGlobal("fetch", answer(200, { path: "C:/a.csv" }));
    expect(await apiPost("files/choose", { mode: "OPEN" })).toEqual({ path: "C:/a.csv" });
  });

  it("turns an error answer into an ApiError", async () => {
    vi.stubGlobal("fetch", answer(400, { error: "operator.length", message: "Too short" }));
    await expect(apiPost("app/operator", {})).rejects.toEqual(new ApiError("operator.length", "Too short", 400));
  });
});
```

**Step 2:** `npx vitest run src/apiClient.test.ts`. Expected: FAIL.

**Step 3: Implementation**

```ts
import { HOST } from "./api";

/** An answer of the API that is not a success: its code, and the message to show (ApiExceptionHandler). */
export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

// Without it the server refuses the call (ApiHeaderFilter): a page of another site cannot send it
const HEADERS = { "X-Collect-Earth": "1" };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(HOST + "api/" + path, {
    method,
    headers: body === undefined ? HEADERS : { ...HEADERS, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new ApiError(data?.error ?? "http." + r.status, data?.message ?? data?.details ?? r.statusText, r.status);
  return data as T;
}

export const apiGet = <T>(path: string) => call<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {});
export const apiPut = <T>(path: string, body: unknown) => call<T>("PUT", path, body);
```

**Step 4:** Run. Expected: PASS. `npx tsc --noEmit`: no errors.

**Step 5:** Commit `Frontend: a client for /earth/api`.

---

### Task 13: Server texts in the frontend

**Files:** Create `$F/serverTexts.ts`; Test `$F/serverTexts.test.ts`.

**Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { serverText } from "./serverTexts";

describe("serverText", () => {
  it("gives the text of a key", () => {
    expect(serverText({ "CollectEarthWindow.11": "Salir" }, "CollectEarthWindow.11")).toBe("Salir");
  });
  it("drops the Swing HTML and the mnemonic marks", () => {
    expect(serverText({ k: "<html>Are you sure?<br>Really</html>" }, "k")).toBe("Are you sure?\nReally");
    expect(serverText({ k: "&Exit" }, "k")).toBe("Exit");
  });
  it("shows the key when the text is missing, as Messages does", () => {
    expect(serverText({}, "Nope.1")).toBe("!Nope.1!");
  });
});
```

**Step 2:** Run. Expected: FAIL.

**Step 3: Implementation**

```ts
import { useEffect, useState } from "react";
import { apiGet } from "./apiClient";

export type Texts = Record<string, string>;

/**
 * A text of Messages*.properties (MessagesController), as plain text: some carry the HTML of Swing labels, and an
 * "&" marks a mnemonic. A missing one shows as "!key!", as Messages.getString does, so it is noticed.
 */
export function serverText(texts: Texts, key: string): string {
  const text = texts[key];
  if (text === undefined) return "!" + key + "!";
  return text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&(?=\w)/g, "");
}

/** The texts of the language, loaded once per language. */
export function useServerTexts(language: string): Texts {
  const [texts, setTexts] = useState<Texts>({});
  useEffect(() => {
    let current = true;
    apiGet<{ texts: Texts }>("messages?lang=" + encodeURIComponent(language))
      .then((r) => { if (current) setTexts(r.texts); })
      .catch(() => { /* the keys show: noticed, and the next language change tries again */ });
    return () => { current = false; };
  }, [language]);
  return texts;
}
```

**Step 4:** Run. Expected: PASS.

**Step 5:** Commit `Frontend: the texts of the Swing UI, in the page's language`.

---

### Task 14: Menu model

**Files:** Create `$F/menus.ts`; Test `$F/menus.test.ts`.

**Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { appMenus } from "./menus";

describe("appMenus", () => {
  it("keeps the order of the Swing menu bar", () => {
    expect(appMenus({ plotsMap: true }).map((m) => m.id)).toEqual(["project", "data", "tools", "utilities", "settings", "help"]);
  });
  it("only enables what is built", () => {
    const enabled = appMenus({ plotsMap: true }).flatMap((m) => m.items).filter((i) => i.enabled).map((i) => i.id);
    expect(enabled).toEqual(["quit"]);
  });
  it("offers to open the plots map only with the Google Earth Pro viewer", () => {
    const ids = (plotsMap: boolean) => appMenus({ plotsMap }).flatMap((m) => m.items).map((i) => i.id);
    expect(ids(false)).toContain("openPlotsMap");
    expect(ids(true)).not.toContain("openPlotsMap");
  });
});
```

**Step 2:** Run. Expected: FAIL.

**Step 3: Implementation** — the labels are the Swing keys, so every language already has them:

```ts
/** An entry of the app bar's menus. `label` is a key of Messages*.properties (serverTexts.ts). */
export interface MenuItem { id: string; label: string; enabled: boolean }
export interface Menu { id: string; label: string; items: MenuItem[] }

// The entries built so far: the others show, disabled, until their stage of docs/plans/2026-10-28-html-ui-design.md
const BUILT = new Set(["quit"]);

const item = (id: string, label: string): MenuItem => ({ id, label, enabled: BUILT.has(id) });

/** The menus of the app bar, in the order of the Swing menu bar (CollectEarthMenu), so users find things where they were. */
export function appMenus(app: { plotsMap: boolean }): Menu[] {
  return [
    { id: "project", label: "CollectEarthWindow.10", items: [
      item("importCep", "CollectEarthMenu.0"),
      item("joinCloud", "CollectEarthMenu.joinCloudProject"),
      item("cloudStatus", "CloudSyncStatusDialog.menuItem"),
      item("language", "CollectEarthWindow.2"),
      item("quit", "CollectEarthWindow.11"),
    ] },
    { id: "data", label: "CollectEarthWindow.44", items: [
      item("export", "CollectEarthWindow.13"),
      item("importZip", "CollectEarthWindow.46"),
      item("updateCsv", "CollectEarthWindow.55"),
    ] },
    { id: "tools", label: "CollectEarthWindow.12", items: [
      item("saiku", "CollectEarthWindow.14"),
      item("saikuTool", "CollectEarthWindow.71"),
      item("lulucf", "CollectEarthWindow.72"),
      item("loadKml", "CollectEarthWindow.54"),
      item("dataFolder", "CollectEarthWindow.67"),
      ...(app.plotsMap ? [] : [item("openPlotsMap", "CollectEarthMenu.openPlotsMap")]),
    ] },
    { id: "utilities", label: "CollectEarthMenu.2", items: [
      item("missingPlots", "CollectEarthWindow.18"),
      item("divideCsv", "CollectEarthMenu.3"),
      item("deletePlots", "CollectEarthMenu.10"),
    ] },
    { id: "settings", label: "CollectEarthWindow.15", items: [item("settings", "CollectEarthWindow.15")] },
    { id: "help", label: "CollectEarthWindow.16", items: [
      item("surveyGuide", "CollectEarthWindow.70"),
      item("manual", "CollectEarthWindow.50"),
      item("support", "CollectEarthWindow.64"),
      item("log", "CollectEarthWindow.52"),
      item("updates", "CollectEarthWindow.51"),
      item("disclaimer", "CollectEarthWindow.17"),
      item("about", "CollectEarthWindow.56"),
    ] },
  ];
}
```

(The Data menu's single "Export…" entry becomes the export dialog in stage 3; until then its label is the CSV one.)

**Step 4:** Run. Expected: PASS.

**Step 5:** Commit `Frontend: the menus of the app bar, from the Swing menu bar`.

---

### Task 15: App bar, operator and Quit

**Files:**
- Create: `$F/components/AppBar.tsx`, `$F/app.ts` (the `/api/app` hook)
- Modify: `$F/App.tsx` (render the bar above the existing layout)

**Step 1:** `app.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "./apiClient";

export interface AppInfo { project: string | null; operator: string | null; language: string; viewer: string; plotsMap: boolean; version: string | null }

/** What the app bar shows (AppInfoController), and a way to read it again after a change. */
export function useAppInfo(): [AppInfo | null, () => void] {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const reload = useCallback(() => { apiGet<AppInfo>("app").then(setInfo).catch(() => { /* the bar waits */ }); }, []);
  useEffect(reload, [reload]);
  return [info, reload];
}
```

**Step 2:** `components/AppBar.tsx`: an MUI `AppBar position="static" color="default" elevation={1}` with
`Toolbar variant="dense"`: the Collect Earth logo (reuse `form/collect-earth-logo.png`) and the project name; one
`Button` per menu opening an MUI `Menu` of its items (disabled ones with a "Coming soon" tooltip, text from
`i18n.ts`, add `appBar.comingSoon` to its four catalogues); on the right an operator `Chip` (person icon) that opens
a `Dialog` with a `TextField` and Save calling `apiPut("app/operator", {operator})`, showing an `ApiError`'s message
under the field, then `reload()`. When the operator is empty, open that dialog by itself (as the Swing window told
the user, `CollectEarthWindow.35`). Item `quit`: a confirm `Dialog` with `CollectEarthWindow.22` (through
`serverText`) and the buttons `CollectEarthWindow.42` / `CollectEarthWindow.37`, then `apiPost("actions/quit")`
and show "Collect Earth closed: you can close this window" over the page. Props:
`{ info: AppInfo; texts: Texts; reload: () => void; compact: boolean }`; `compact` (narrow window or `IN_PANEL`)
puts all the menus under one `IconButton` (MenuIcon) as nested sections.

**Step 3:** `App.tsx`: wrap the current outer `Box` in a column `Box` (`height: "100vh"`, `display: flex`,
`flexDirection: column`), the `AppBar` first, the existing layout in a `Box` with `flex: 1, minHeight: 0`. Texts:
`useServerTexts(state.language)`. Keep everything else as is.

**Step 4:** `npx tsc --noEmit` and `npx vitest run`: no errors, all pass. Then `npm run dev` with the app running
and look at `http://localhost:5173/earth/map`: the bar shows, Quit asks first.

**Step 5:** Commit `Frontend: the app bar, with the operator and Quit`.

---

### Task 16: Home page for the Google Earth Pro viewer

**Files:**
- Create: `$F/home.ts`, `$F/home.test.ts`, `$F/components/HomePage.tsx`
- Modify: `$F/App.tsx`

**Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { isHome, statusCounts } from "./home";

describe("home", () => {
  it("is the map page asked for with ?home", () => {
    expect(isHome("?home")).toBe(true);
    expect(isHome("?plot=12")).toBe(false);
  });
  it("counts the plots by status", () => {
    expect(statusCounts(["a", "b", "c", "d"], { a: "saved", b: "partial", c: "saved" }))
      .toEqual({ saved: 2, partial: 1, empty: 1, total: 4 });
  });
});
```

**Step 2:** Run. Expected: FAIL.

**Step 3: Implementation**

```ts
import type { PlotStatus } from "./types";

/** The app without a map, which Collect Earth opens with the Google Earth Pro viewer (BrowserService.homeUrl). */
export function isHome(search: string): boolean {
  return new URLSearchParams(search).has("home");
}
export const IN_HOME = typeof window !== "undefined" && isHome(window.location.search);

/** How many plots are done, started and not started: a plot with no status yet is not started. */
export function statusCounts(ids: string[], statuses: Record<string, PlotStatus | undefined>) {
  const counts = { saved: 0, partial: 0, empty: 0, total: ids.length };
  for (const id of ids) {
    const s = statuses[id];
    if (s === "saved") counts.saved++; else if (s === "partial") counts.partial++; else counts.empty++;
  }
  return counts;
}
```

(Check the `PlotStatus` values in `types.ts`; use its names if they differ.)

`components/HomePage.tsx`: the project name large; the operator; a `LinearProgress` and three numbers (done /
partial / not started) from `statusCounts(state.order, state.statuses)`; text explaining the plots are in Google Earth
Pro. `App.tsx`: when `IN_HOME`, render `AppBar` + `HomePage` instead of the sidebar, map and form (start the controller
as for the panel: `controller.start(null)`, so statuses load).

**Step 4:** Run tests: PASS. Typecheck clean.

**Step 5:** Commit `Frontend: the home page for the Google Earth Pro viewer`.

---

### Task 17: Full build

**Step 1:** From `collect-earth-app`: `mvn -q install -DskipTests` (with npm, so the frontend is built into
`target/classes/leafletmap`). Expected: exit 0.

**Step 2:** `mvn -q test "-Dskip.npm"`. Expected: exit 0. `cd src/main/frontend && npx vitest run`: all pass.

---

### Task 18: Check it in the real app

Run on JRE 21: from `collect-earth-app`, `C:\opt\jre-21.0.12.1+1\bin\java.exe -jar target/CollectEarth.jar`.

Check, and fix what fails (each fix: test first where it can be tested):
1. No Swing main window; the plots map opens with the app bar (plots-map viewer); the tray icon is there.
2. Each menu shows its items in the UI language; only Quit is enabled.
3. The operator chip shows the operator; a 3-letter name is refused with the message; a valid one is saved
   (`earth.properties`).
4. Quit asks, then the process ends (no `java.exe` for `CollectEarth.jar` left) and the page says so.
5. Tray: Open Collect Earth brings the page back after closing it; Quit quits.
6. In the browser's console: `fetch("/earth/api/app")` without the header → 403; from another origin page → 403.
7. `fetch("/earth/api/jobs/nope", {headers: {"X-Collect-Earth": "1"}})` → 404; a bad operator → 400 with
   `{error, message}` (if empty: the note at the end of Task 4).
8. Settings → viewer Google Earth Pro, restart: Google Earth Pro opens with the KML, and the home page opens with the
   plot counts.
9. `POST /api/files/choose` from the console (`{mode:"FOLDER"}`): the dialog comes in front of the browser.

**Step:** Commit fixes; then update `docs/plans/2026-10-28-html-ui-design.md` (the header instead of the token) and
`collect-earth-app/src/main/frontend/README.md` (the app bar, `?home`, `/api`), commit
`HTML UI stage 1: the app page is the main window`.

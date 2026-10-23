package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeoutException;

import org.junit.jupiter.api.Test;
import org.openqa.selenium.WebDriverException;

/** How {@link BidiTabDriver} sorts out the failures of BiDi commands and reads the answers of scripts, no browser. */
public class BidiTabDriverTest {

	/** What Selenium 4.48 throws when a BiDi command gets no answer in time (Connection.sendAndWait). */
	private static Exception noAnswer() {
		return new org.openqa.selenium.TimeoutException(new TimeoutException());
	}

	@Test
	public void aScriptThePageHadNoTimeToRunIsABusyPageNotAFault() {
		RuntimeException failure = BidiTabDriver.failure("tab1", true, noAnswer(), true);
		assertTrue(failure instanceof PageScriptException, String.valueOf(failure));
		assertTrue(((PageScriptException) failure).isPageBusy());
		assertFalse(((PageScriptException) failure).isDocumentReplaced());
	}

	@Test
	public void anotherCommandWithNoAnswerIsAFault() {
		assertTrue(BidiTabDriver.failure("tab1", false, noAnswer(), true) instanceof BidiCommandException);
	}

	@Test
	public void aScriptThatFailsInTheBrowserIsStillAFault() {
		RuntimeException failure = BidiTabDriver.failure("tab1", true,
				new WebDriverException("{\"error\":\"unknown error\",\"message\":\"something broke\"}"), true);
		assertTrue(failure instanceof BidiCommandException, String.valueOf(failure));
	}

	@Test
	public void aDocumentReplacedIsStillTriedAgain() {
		RuntimeException failure = BidiTabDriver.failure("tab1", true,
				new WebDriverException("Inspected target navigated or closed"), true);
		assertTrue(((PageScriptException) failure).isDocumentReplaced());
	}

	@Test
	public void aClosedTabIsStillAClosedTab() {
		assertTrue(BidiTabDriver.failure("tab1", true,
				new WebDriverException("{\"error\":\"no such frame\"}"), true) instanceof TabClosedException);
	}

	@Test
	public void theValueOfAScriptIsItsJsonText() {
		Map<String, Object> value = new HashMap<>();
		value.put("type", "string");
		value.put("value", "[1,2]");
		Map<String, Object> answer = new HashMap<>();
		answer.put("type", "success");
		answer.put("result", value);
		assertEquals("[1,2]", BidiTabDriver.scriptValue("tab1", answer));
	}

	@Test
	public void aScriptThatThrowsInThePageGivesItsMessage() {
		Map<String, Object> details = new HashMap<>();
		details.put("text", "TypeError: x is null");
		Map<String, Object> answer = new HashMap<>();
		answer.put("type", "exception");
		answer.put("exceptionDetails", details);
		PageScriptException thrown = assertThrows(PageScriptException.class, () -> BidiTabDriver.scriptValue("tab1", answer));
		assertEquals("TypeError: x is null", thrown.getMessage());
		assertFalse(thrown.isPageBusy());
	}
}

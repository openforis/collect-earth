package org.openforis.collect.earth.core.handlers;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.text.MessageFormat;
import java.util.Locale;
import java.util.ResourceBundle;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.view.Messages;

/**
 * The messages come from the bundle of collect-earth-app, which is why this is tested here and not next to the handlers
 */
class InvalidValueMessageTest {

	@Test
	void saysWhatKindOfValueWasExpected() {
		assertEquals("'07/2024' is not a whole number",
				BalloonInputFieldsUtils.getInvalidValueMessage(new IntegerAttributeHandler(), "07/2024"));
		assertEquals("'12,5%' is not a number",
				BalloonInputFieldsUtils.getInvalidValueMessage(new RealAttributeHandler(), "12,5%"));
		assertEquals("'half past two' is not a time, write it as HH:MM",
				BalloonInputFieldsUtils.getInvalidValueMessage(new TimeAttributeHandler(), "half past two"));
	}

	// The balloon shows the message as HTML, and the value is whatever was typed
	@Test
	void whatWasTypedCannotBecomeHtml() {
		assertEquals("'&lt;b&gt;1&lt;/b&gt; &amp; &quot;2&quot;' is not a number",
				BalloonInputFieldsUtils.getInvalidValueMessage(new RealAttributeHandler(), "<b>1</b> & \"2\""));
	}

	// The translations are MessageFormat patterns too : an apostrophe in French is written twice, or the value is lost
	@Test
	void isTranslated() {
		assertEquals("'abc' no es un número", format("es", "BalloonInputFieldsUtils.1"));
		assertEquals("'abc' n'est pas un nombre entier", format("fr", "BalloonInputFieldsUtils.0"));
		assertEquals("'abc' não é uma hora, escreva-a como HH:MM", format("pt", "BalloonInputFieldsUtils.2"));
	}

	private static String format(String language, String key) {
		return MessageFormat.format(ResourceBundle.getBundle(Messages.BUNDLE_NAME, new Locale(language)).getString(key), "abc");
	}
}

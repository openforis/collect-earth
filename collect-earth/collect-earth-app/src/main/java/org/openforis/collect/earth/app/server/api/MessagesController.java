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
 * translated a second time in the frontend. Read for the language asked for, not the one Messages is set to, so a page
 * can switch language before the setting is saved. A language with no bundle gets English, the base bundle, and the
 * answer says so in its language, so the page knows which texts it got.
 */
@RestController
public class MessagesController {

	/**
	 * Without this control ResourceBundle tries the JVM's default locale before the base bundle, and Messages.setLocale
	 * makes that the UI language: a language with no bundle would get the texts of the UI language instead of English.
	 */
	private static final ResourceBundle.Control NO_FALLBACK = ResourceBundle.Control
			.getNoFallbackControl(ResourceBundle.Control.FORMAT_DEFAULT);

	@GetMapping("/api/messages")
	public Map<String, Object> messages(@RequestParam("lang") String lang) {
		// es_AR is how Locale.toString() writes a locale, but it is not a language tag: forLanguageTag would silently
		// answer the root locale for it, and so English
		Locale locale = Locale.forLanguageTag(lang.replace('_', '-'));
		ResourceBundle bundle = ResourceBundle.getBundle(Messages.BUNDLE_NAME, locale, NO_FALLBACK);
		Map<String, String> texts = new TreeMap<>();
		for (String key : bundle.keySet()) {
			texts.put(key, bundle.getString(key));
		}
		// The base bundle, Messages.properties, is the English one, and has the root locale
		String language = bundle.getLocale().getLanguage();
		Map<String, Object> answer = new TreeMap<>();
		answer.put("language", language.isEmpty() ? Locale.ENGLISH.getLanguage() : language);
		answer.put("texts", texts);
		return answer;
	}
}

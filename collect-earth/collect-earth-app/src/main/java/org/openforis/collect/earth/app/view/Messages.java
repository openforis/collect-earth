package org.openforis.collect.earth.app.view;

import java.util.Locale;
import java.util.MissingResourceException;
import java.util.ResourceBundle;

public class Messages {
	private static final String BUNDLE_NAME = "org.openforis.collect.earth.app.view.messages"; //$NON-NLS-1$

	private static ResourceBundle RESOURCE_BUNDLE = ResourceBundle.getBundle(BUNDLE_NAME);

	private Messages() {
	}
	
	public static void setLocale(Locale localeUI){
		Locale.setDefault( localeUI );
		RESOURCE_BUNDLE = ResourceBundle.getBundle(BUNDLE_NAME);		
	}

	public static String getString(String key) {
		try {
			return RESOURCE_BUNDLE.getString(key);
		} catch (MissingResourceException e) {
			return '!' + key + '!';
		}
	}
}

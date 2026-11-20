package org.openforis.collect.earth.app.view;

import java.util.Locale;
import java.util.ResourceBundle;

import javax.swing.JComponent;

public class Messages {
	public static final String BUNDLE_NAME = "org.openforis.collect.earth.app.view.Messages"; //$NON-NLS-1$

	private static ResourceBundle RESOURCE_BUNDLE;
	static {
		try {
			RESOURCE_BUNDLE = ResourceBundle.getBundle(BUNDLE_NAME);
		} catch(Exception e) {
			RESOURCE_BUNDLE = null;
		}
	}

	private Messages() {
	}
	
	public static void setLocale(Locale localeUI){
		Locale.setDefault( localeUI );
		JComponent.setDefaultLocale( localeUI );
		RESOURCE_BUNDLE = ResourceBundle.getBundle(BUNDLE_NAME);		
	}

	public static String getString(String key) {
		if (RESOURCE_BUNDLE != null) {
			try {
				return RESOURCE_BUNDLE.getString(key);
			} catch (Exception e) {}
		}
		return '!' + key + '!';
	}
	
	
	
}

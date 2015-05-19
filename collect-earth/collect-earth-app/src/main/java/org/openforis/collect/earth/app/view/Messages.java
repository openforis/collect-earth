package org.openforis.collect.earth.app.view;

import java.util.Enumeration;
import java.util.Locale;
import java.util.MissingResourceException;
import java.util.PropertyResourceBundle;
import java.util.ResourceBundle;

import javax.swing.JComponent;

public class Messages {
	public static final String BUNDLE_NAME = "org.openforis.collect.earth.app.view.Messages"; //$NON-NLS-1$

	private static ResourceBundle RESOURCE_BUNDLE = ResourceBundle.getBundle(BUNDLE_NAME);

	private Messages() {
	}
	
	public static void setLocale(Locale localeUI){
		Locale.setDefault( localeUI );
		JComponent.setDefaultLocale( localeUI );
		RESOURCE_BUNDLE = ResourceBundle.getBundle(BUNDLE_NAME);		
	}

	public static String getString(String key) {
		try {
			return RESOURCE_BUNDLE.getString(key);
		} catch (MissingResourceException e) {
			return '!' + key + '!';
		}
	}
	
	
	/**
	 * Utility method to find the labels that have not yet been translated from the English original to another language
	 * The output (in the console) are the original english lables that need to be translated and set in the destination language
	 * @param toLanguage The language to check against english (so far it can be ES,PT or FR)
	 */
	private static void printMissingTranslations(String toLanguage){

		PropertyResourceBundle originalEnglishLabels = (PropertyResourceBundle) ResourceBundle.getBundle(Messages.BUNDLE_NAME, Locale.ENGLISH);
		PropertyResourceBundle translatedLabels = (PropertyResourceBundle)  ResourceBundle.getBundle(Messages.BUNDLE_NAME, new Locale(toLanguage));
		
		// Go through the contents of the original English labels and try to find the translation
		// If the translation is not found then print the original to console
		Enumeration<String> keys = originalEnglishLabels.getKeys();
		
		String key = null;
		while( keys.hasMoreElements() ){
			key = keys.nextElement();
			String translatedValue = (String) translatedLabels.handleGetObject(key);
			if( translatedValue == null || translatedValue.length() == 0 ){
				System.out.println( key + "=" + originalEnglishLabels.getString(key) );
			}
		}
		
	}
	
	public static void main(String[] args) {
		printMissingTranslations( args.length==0?"ES":args[0]);
	}
}

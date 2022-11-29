package org.openforis.collect;

import java.util.Locale;

import org.openforis.collect.manager.MessageSource;
import org.openforis.collect.manager.ResourceBundleMessageSource;

/**
 * 
 * @author S. Ricci
 *
 */
public class ProxyContext {

	private Locale locale;
	private MessageSource messageSource;
	
	public ProxyContext(Locale locale) {
		this(locale, new ResourceBundleMessageSource());
	}

	public ProxyContext(Locale locale, MessageSource messageSource) {
		super();
		this.locale = locale;
		this.messageSource = messageSource;
	}
	
	public Locale getLocale() {
		return locale;
	}
	
	public MessageSource getMessageSource() {
		return messageSource;
	}
	
}

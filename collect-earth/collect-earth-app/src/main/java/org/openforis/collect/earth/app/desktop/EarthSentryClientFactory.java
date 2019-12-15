package org.openforis.collect.earth.app.desktop;

import io.sentry.DefaultSentryClientFactory;
import io.sentry.context.ContextManager;
import io.sentry.context.SingletonContextManager;
import io.sentry.dsn.Dsn;

public class EarthSentryClientFactory extends DefaultSentryClientFactory {
    
    @Override
    protected ContextManager getContextManager(Dsn dsn) {
    	return new SingletonContextManager();
    }
}
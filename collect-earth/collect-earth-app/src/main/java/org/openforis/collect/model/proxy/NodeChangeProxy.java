package org.openforis.collect.model.proxy;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

import org.openforis.collect.Proxy;
import org.openforis.collect.ProxyContext;
import org.openforis.collect.manager.MessageSource;
import org.openforis.collect.model.AttributeAddChange;
import org.openforis.collect.model.AttributeChange;
import org.openforis.collect.model.EntityAddChange;
import org.openforis.collect.model.EntityChange;
import org.openforis.collect.model.NodeChange;
import org.openforis.collect.model.NodeDeleteChange;

/**
 * 
 * @author S. Ricci
 *
 * @param <T> NodeChange
 */
public class NodeChangeProxy<C extends NodeChange<?>> implements Proxy {

	protected transient C change;
	protected transient ProxyContext context;

	public NodeChangeProxy(C change, ProxyContext context) {
		this.context = context;
	}

	public static List<NodeChangeProxy<?>> fromList(Collection<NodeChange<?>> items, ProxyContext context) {
		List<NodeChangeProxy<?>> result = new ArrayList<NodeChangeProxy<?>>();
		if ( items != null ) {
			for (NodeChange<?> item : items) {
				NodeChangeProxy<?> proxy;
				if ( item instanceof AttributeAddChange ) {
					proxy = new AttributeAddChangeProxy((AttributeAddChange) item, context);
				} else if ( item instanceof EntityAddChange ) {
					proxy = new EntityAddChangeProxy((EntityAddChange) item, context);
				} else if ( item instanceof AttributeChange ) {
					proxy = new AttributeChangeProxy((AttributeChange) item, context);
				} else if ( item instanceof EntityChange) {
					proxy = new EntityChangeProxy((EntityChange) item, context);
				} else if ( item instanceof NodeDeleteChange ) {
					proxy = new NodeDeleteChangeProxy((NodeDeleteChange) item, context);
				} else {
					throw new IllegalArgumentException("NodeChange type not supported: " + item.getClass().getSimpleName());
				}
				result.add(proxy);
			}
		}
		return result;
	}
	
	public int getNodeId() {
		return change.getNode().getInternalId();
	}
	
	protected Locale getLocale() {
		return context.getLocale();
	}
	
	protected MessageSource getMessageSource() {
		return context.getMessageSource();
	}

}
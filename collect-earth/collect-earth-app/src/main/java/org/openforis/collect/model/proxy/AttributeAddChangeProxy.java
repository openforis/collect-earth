package org.openforis.collect.model.proxy;

import org.openforis.collect.ProxyContext;
import org.openforis.collect.model.AttributeChange;

/**
 * 
 * @author S. Ricci
 *
 */
public class AttributeAddChangeProxy extends AttributeChangeProxy implements NodeAddChangeProxy {

	public AttributeAddChangeProxy(AttributeChange change, ProxyContext context) {
		super(change, context);
	}

	@Override
	public NodeProxy getCreatedNode() {
		return NodeProxy.fromNode(change.getNode(), context);
	}

}
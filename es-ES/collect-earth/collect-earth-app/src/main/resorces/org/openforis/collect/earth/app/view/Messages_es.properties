package org.openforis.collect.model.proxy;

import org.openforis.collect.ProxyContext;
import org.openforis.collect.model.EntityChange;

/**
 * 
 * @author S. Ricci
 *
 */
public class EntityAddChangeProxy extends EntityChangeProxy implements NodeAddChangeProxy {

	public EntityAddChangeProxy(EntityChange change, ProxyContext context) {
		super(change, context);
	}

	@Override
	public NodeProxy getCreatedNode() {
		return NodeProxy.fromNode(change.getNode(), context);
	}
	
}
package org.openforis.collect.model.proxy;

import org.openforis.collect.ProxyContext;
import org.openforis.collect.model.NodeDeleteChange;

/**
 * 
 * @author S. Ricci
 *
 */
public class NodeDeleteChangeProxy extends NodeChangeProxy<NodeDeleteChange> {

	public NodeDeleteChangeProxy(NodeDeleteChange change, ProxyContext context) {
		super(change, context);
	}

	public Integer getDeletedNodeId() {
		return change.getNode().getInternalId();
	}

}
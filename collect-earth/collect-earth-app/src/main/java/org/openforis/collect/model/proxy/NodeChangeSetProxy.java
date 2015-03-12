/**
 * 
 */
package org.openforis.collect.model.proxy;

import java.util.List;

import org.openforis.collect.Proxy;
import org.openforis.collect.ProxyContext;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.NodeChangeSet;

/**
 * @author S. Ricci
 *
 */
public class NodeChangeSetProxy implements Proxy {

	private transient NodeChangeSet changeSet;
	private transient CollectRecord record;
	private boolean recordSaved;
	private ProxyContext context;
	
	public NodeChangeSetProxy(CollectRecord record,	NodeChangeSet changeSet, ProxyContext context) {
		super();
		this.record = record;
		this.changeSet = changeSet;
		this.context = context;
	}

	public List<NodeChangeProxy<?>> getChanges() {
		return NodeChangeProxy.fromList(changeSet.getChanges(), context);
	}

	public boolean isRecordSaved() {
		return recordSaved;
	}
	
	public void setRecordSaved(boolean recordSaved) {
		this.recordSaved = recordSaved;
	}

	public Integer getErrors() {
		return record.getErrors();
	}

	public Integer getSkipped() {
		return record.getSkipped();
	}

	public Integer getMissing() {
		return record.getMissing();
	}

	public Integer getWarnings() {
		return record.getWarnings();
	}

	public Integer getMissingErrors() {
		return record.getMissingErrors();
	}

	public Integer getMissingWarnings() {
		return record.getMissingWarnings();
	}
	
}

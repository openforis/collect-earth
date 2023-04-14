package org.openforis.collect.earth.app.service;

import org.openforis.collect.manager.process.ProcessStatus;

public class ExtdDataExportStatus extends  ProcessStatus{

	public enum ExtdFormat {
		KML
	}
	
	private ExtdFormat format;

	public ExtdDataExportStatus(ExtdFormat format) {
		super();
		this.format = format;
	}
	
	public ExtdFormat getFormat() {
		return format;
	}

}

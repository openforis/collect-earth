package org.openforis.collect.earth.app.service;

import java.io.File;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.openforis.collect.earth.app.service.ExtdDataExportStatus.ExtdFormat;
import org.openforis.collect.io.data.CSVDataExportJob;
import org.openforis.collect.manager.process.AbstractProcess;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.config.ConfigurableBeanFactory;
import org.springframework.context.annotation.Scope;
import org.springframework.stereotype.Component;

/**
 * 
 * @author S. Ricci
 *
 * @deprecated Use {@link CSVDataExportJob instead}
 *
 */
@Component
@Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
public class KMLExportProcess extends AbstractProcess<Void, ExtdDataExportStatus> {

	@Autowired
	private KmlGeneratorService kmlGeneratorService;
	
	private File outputFile;
	
	public KMLExportProcess() {
		super();
	}
	
	@Override
	protected void initStatus() {
		this.status = new ExtdDataExportStatus(ExtdFormat.KML);		
	}
	
	@Override
	public void startProcessing() throws Exception {
		super.startProcessing();
		exportData();
	}
	
	private void exportData() throws Exception {
		kmlGeneratorService.exportToKml(getOutputFile());
	}

	
	public File getOutputFile() {
		return outputFile;
	}

	public void setOutputFile(File outputFile) {
		this.outputFile = outputFile;
	}


}


package org.openforis.collect.earth.ipcc;

import javax.swing.SwingUtilities;

import org.openforis.collect.earth.app.service.ProcessRDBData;
import org.openforis.collect.earth.app.service.RDBExporter;
import org.openforis.collect.earth.app.service.RDBExporter.ExportType;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.app.view.InfiniteProgressMonitor;
import org.openforis.concurrency.Progress;
import org.openforis.idm.metamodel.Survey;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class IPCCRDBGenerator {
	
	@Autowired
	RDBExporter rdbExporter;
	
	@Autowired
	private RegionCalculationUtils regionCalculation;
	
	public void generateRelationalDatabase(Survey modifiedSurvey, InfiniteProgressMonitor infiniteProgressMonitor  ) {
		
		ProcessRDBData ipccCallback = postProcessIpccData();
		rdbExporter.exportDataToRDB(modifiedSurvey, ExportType.IPCC, infiniteProgressMonitor, ipccCallback);
		
	}

	private ProcessRDBData postProcessIpccData() {

		// return the implementation of a ProcessRDBData interface (the callback when the initial RDB export is done so that we can add expansion factors )
		return (progressMonitor) -> {
			
			SwingUtilities.invokeLater( () -> progressMonitor.setMessage("Calculating expansion factors") );
			progressMonitor.progressMade(new Progress(0, 100));
			regionCalculation.handleRegionCalculation( ExportType.SAIKU );
			progressMonitor.progressMade(new Progress(100, 100));		
			
		};
	}
	
	
}

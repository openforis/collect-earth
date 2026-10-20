package org.openforis.collect.earth.ipcc;

import javax.swing.SwingUtilities;

import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RDBExporter;
import org.openforis.collect.earth.app.service.RDBPostProcessor;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.app.view.InfiniteProgressMonitor;
import org.openforis.concurrency.Progress;
import org.openforis.idm.metamodel.Survey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class IPCCRDBGenerator  {

	private static final Logger logger = LoggerFactory.getLogger(IPCCRDBGenerator.class);
	
	@Autowired
	RDBExporter rdbExporter;
	
	@Autowired
	private RegionCalculationUtils regionCalculation;
	
	public void generateRelationalDatabase(Survey modifiedSurvey, InfiniteProgressMonitor infiniteProgressMonitor) {
		RDBPostProcessor ipccCallback = postProcessIpccData();
		if (!rdbExporter.exportDataToRDB(modifiedSurvey, ExportType.IPCC, infiniteProgressMonitor, ipccCallback)) {
			logger.warn("The IPCC database was not post-processed, the expansion factors of its plots may be missing");
		}
	}

	private RDBPostProcessor postProcessIpccData() {
		// return the implementation of a RDBPostProcessor interface (the callback when the initial RDB export is done so that we can add expansion factors )
		return (progressMonitor) -> {
			
			SwingUtilities.invokeLater( () -> progressMonitor.setMessage("Calculating expansion factors") );
			progressMonitor.progressMade(new Progress(0, 100));
			regionCalculation.handleRegionCalculation( ExportType.IPCC, rdbExporter.getJdbcTemplate() );
			progressMonitor.progressMade(new Progress(100, 100));		
			
		};
	}
	
	
}

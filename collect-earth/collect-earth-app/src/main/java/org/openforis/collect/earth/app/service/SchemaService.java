package org.openforis.collect.earth.app.service;

import org.openforis.collect.earth.app.EarthConstants;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class SchemaService {

	@Autowired
	LocalPropertiesService localPropertiesService;
	
	private String getSchemaName(ExportType exportType) {
		String schemaName = null;
		if (localPropertiesService.isUsingPostgreSqlDB()) {
			schemaName = EarthConstants.POSTGRES_RDB_SCHEMA_IPCC;
		}
		return schemaName;
	}

	public String getSchemaPrefix(ExportType exportType) {
		String schemaName = getSchemaName(exportType);
		if (schemaName != null) {
			schemaName += "."; //$NON-NLS-1$
		} else {
			schemaName = ""; //$NON-NLS-1$
		}
		return schemaName;
	}
	
}

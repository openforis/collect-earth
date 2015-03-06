package org.openforis.collect.earth.core.rdb;

import org.openforis.collect.relational.model.RelationalSchemaConfig;


/**
 * 
 * @author S. Ricci
 *
 */
public class RelationalSchemaContext {

	private RelationalSchemaConfig rdbConfig;
	
	public RelationalSchemaContext() {
		rdbConfig = RelationalSchemaConfig.createDefault();
		rdbConfig.setIdColumnPrefix("_");
		rdbConfig.setIdColumnSuffix("_id");
		rdbConfig.setTextMaxLength(4096);
		rdbConfig.setMemoMaxLength(4096);
	}
	
	public RelationalSchemaConfig getRdbConfig() {
		return rdbConfig;
	}
	
}

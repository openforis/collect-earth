package org.openforis.collect.earth.app.server;

import java.util.Map;

public interface DataAccessor {

	public Map<String, String> getData(String gePlacemarkId);

	public boolean saveData(Map<String, String> collectedData);
}

package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Node;

public class EntityHandler extends AbstractAttributeHandler<Entity> {

	private static final String PREFIX = "entity_";

	public EntityHandler() {
		super(PREFIX);
	}

	@Override
	public void addOrUpdate(String parameterName, String parameterValue, Entity entity) {

		int count = entity.getCount(parameterName);
		for (int i = 0; i < count; i++) {
			entity.remove(parameterName, 0);
		}

		EntityBuilder.addEntity(entity, parameterName);

	}

	@Override
	protected Entity getAttributeValue(String parameterValue) {
		return EntityBuilder.createEntity(null, parameterValue);
	}

	@Override
	protected void addToEntity(String parameterName, String parameterValue, Entity entity) {

	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		return "";
	}

	@Override
	public boolean isParseable(Node value) {
		return value instanceof Entity;
	}

}

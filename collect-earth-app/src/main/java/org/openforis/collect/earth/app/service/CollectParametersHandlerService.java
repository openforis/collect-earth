package org.openforis.collect.earth.app.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.handler.AbstractAttributeHandler;
import org.openforis.collect.manager.RecordManager;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.Node;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AssignableTypeFilter;

public class CollectParametersHandlerService {

	private static final String PARAMETER_SEPARATOR = "===";

	public static final String COLLECT_PREFIX = "collect_";

	private final List<AbstractAttributeHandler> attributeHandlers = new ArrayList<AbstractAttributeHandler>();

	private final Logger logger = LoggerFactory.getLogger(CollectParametersHandlerService.class);

	@Autowired
	RecordManager recordManager;

	public CollectParametersHandlerService() {
		initiliaze();
	}

	public Map<String, String> getParameters(Entity plotEntity) {
		Map<String, String> parameters = new HashMap<String, String>();

		List<Node<? extends NodeDefinition>> children = plotEntity.getChildren();

		List<EntityDefinition> definitons = plotEntity.getSchema().getRootEntityDefinitions();

		

		for (Node<? extends NodeDefinition> node : children) {
			if (node instanceof Attribute) {
				for (AbstractAttributeHandler handler : attributeHandlers) {
					if (handler.isParseable(node)) {
						// builds ie. "text_parameter"
						String paramName = handler.getPrefix() + node.getName();

						// Saves into "collect_text_parameter"
						String collectParamName = COLLECT_PREFIX + paramName;
						if( parameters.get( collectParamName ) != null ){

							int index = StringUtils.countMatches(parameters.get(collectParamName), PARAMETER_SEPARATOR) + 1;

							parameters.put(
									collectParamName,
									parameters.get(collectParamName) + PARAMETER_SEPARATOR
											+ handler.getAttributeFromParameter(paramName, plotEntity, index));
							
						}else{
							parameters.put(collectParamName, handler.getAttributeFromParameter(paramName, plotEntity));
						}
						break;
					}
				}
			}
		}

		return parameters;
	}

	private void initiliaze() {
		ClassPathScanningCandidateComponentProvider provider = new ClassPathScanningCandidateComponentProvider(false);
		provider.addIncludeFilter(new AssignableTypeFilter(AbstractAttributeHandler.class));

		logger.info("Scanning for classes that can interpret collect attributes");
		// scan in org.example.package
		Set<BeanDefinition> components = provider.findCandidateComponents("org/openforis/collect/earth");
		for (BeanDefinition component : components) {
			try {
				Class cls = Class.forName(component.getBeanClassName());
				attributeHandlers.add((AbstractAttributeHandler) cls.getConstructor().newInstance());
			} catch (Exception e) {
				logger.error("Error when trying to initlize AttributeHandler" + component.getBeanClassName(), e);
			}

		}
		if (attributeHandlers.size() == 0) {
			logger.error("No attribute handlers defined. It is not possible to use the Collect parameter handler without implementations of AbstractAttributeHandler");
		}
	}

	private String removePrefix(String parameterName) {
		return parameterName.substring(COLLECT_PREFIX.length());
	}

	private String removeArraySuffix(String parameterName) {

		int lastUnderscore = parameterName.lastIndexOf("_");
		String passibleInteger = parameterName.substring(lastUnderscore + 1);

		try {
			Integer.parseInt(passibleInteger);

			parameterName = parameterName.substring(0, lastUnderscore);

		} catch (NumberFormatException e) {
			// It is not an integer suffix, do nothing
		}

		return parameterName;
	}


	public void saveToEntity(Map<String, String> parameters, Entity entity) {
		Set<String> parameterNames = parameters.keySet();
		for (String parameterName : parameterNames) {
			String parameterValue = parameters.get(parameterName);
			String cleanName = cleanUpParameterName(parameterName);


			for (AbstractAttributeHandler handler : attributeHandlers) {
				try {
					if (handler.isParameterParseable(cleanName)) {
						// if (parameterValue == null || parameterValue.length() ==
						// 0) {
						// entity.remove(cleanName, 0);
						// } else {
						handler.addOrUpdate(cleanName, parameterValue, entity);
						// }
					}
				} catch (Exception e) {
					logger.error("Error while parsing parameter " + cleanName + " with value " + parameterValue, e);
				}
			}
		}
	}

	private String cleanUpParameterName(String parameterName) {
		parameterName = removeArraySuffix(parameterName);
		parameterName = removePrefix(parameterName);
		return parameterName;
	}

}

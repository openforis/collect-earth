package org.openforis.collect.earth.app.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.handler.AbstractAttributeHandler;
import org.openforis.collect.earth.app.service.handler.CodeAttributeHandler;
import org.openforis.collect.earth.app.service.handler.EntityHandler;
import org.openforis.collect.manager.RecordManager;
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
	private RecordManager recordManager;

	public CollectParametersHandlerService() {
		initiliaze();
	}

	public Map<String, String> getParameters(Entity plotEntity) {
		Map<String, String> parameters = new HashMap<String, String>();

		List<Node<? extends NodeDefinition>> children = plotEntity.getChildren();

		for (Node<? extends NodeDefinition> node : children) {

			for (AbstractAttributeHandler handler : attributeHandlers) {
				if (handler.isParseable(node)) {
				
					// builds ie. "text_parameter"
					String paramName = handler.getPrefix() + node.getName();

					// Saves into "collect_text_parameter"
					String collectParamName = COLLECT_PREFIX + paramName;
					if (node instanceof Attribute) {
						if (parameters.get(collectParamName) != null) {

							int index = StringUtils.countMatches(parameters.get(collectParamName), PARAMETER_SEPARATOR) + 1;

							parameters.put(
									collectParamName,
									parameters.get(collectParamName) + PARAMETER_SEPARATOR
									+ handler.getAttributeFromParameter(paramName, plotEntity, index));

						} else {
							parameters.put(collectParamName, handler.getAttributeFromParameter(paramName, plotEntity));
						}

					} else if (node instanceof Entity) {
						Entity entity = (Entity) node;
						// result should be
						// collect_entity_NAME[KEY].code_attribute
						String entityKey = ((EntityHandler) handler).getEntityKey(entity);
						collectParamName += "[" + entityKey + "]";

						CodeAttributeHandler cah = new CodeAttributeHandler();

						List<Node<? extends NodeDefinition>> entityChildren = entity.getChildren();
						for (Node<? extends NodeDefinition> child : entityChildren) {
							
							if (child instanceof Attribute) {
								parameters.put(collectParamName + ".code_" + child.getName(),
										cah.getAttributeFromParameter(child.getName(), entity));
							}
						}


					}
					break;
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

		String cleanParamater = parameterName;
		int lastUnderscore = cleanParamater.lastIndexOf("_");
		String passibleInteger = cleanParamater.substring(lastUnderscore + 1);

		try {
			Integer.parseInt(passibleInteger);

			cleanParamater = cleanParamater.substring(0, lastUnderscore);

		} catch (NumberFormatException e) {
			// It is not an integer suffix, do nothing
		}

		return cleanParamater;
	}


	public void saveToEntity(Map<String, String> parameters, Entity entity) {
		Set<Entry<String, String>> parameterEntries = parameters.entrySet();
		for (Entry<String, String> entry : parameterEntries) {
			String parameterValue = entry.getValue();
			String cleanName = cleanUpParameterName(entry.getKey());

			for (AbstractAttributeHandler<?> handler : attributeHandlers) {
				try {
					if (handler.isParameterParseable(cleanName)) {
						handler.addOrUpdate(cleanName, parameterValue, entity);
					}
				} catch (Exception e) {
					logger.error("Error while parsing parameter " + cleanName + " with value " + parameterValue, e);
				}
			}
		}
	}

	private String cleanUpParameterName(String parameterName) {
		String cleanParameter = removeArraySuffix(parameterName);
		cleanParameter = removePrefix(cleanParameter);
		return cleanParameter;
	}

}

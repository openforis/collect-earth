package org.openforis.eye.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.Node;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AssignableTypeFilter;

public class CollectParametersHandler {

	public static final String COLLECT_PREFIX = "collect_";

	private final List<AbstractAttributeHandler> attributeHandlers = new ArrayList<AbstractAttributeHandler>();

	private final Logger logger = LoggerFactory.getLogger(CollectParametersHandler.class);

	public CollectParametersHandler() {
		initiliaze();
	}

	public Map<String, String> getParameters(Entity plotEntity) {
		Map<String, String> parameters = new HashMap<String, String>();

		List<Node<? extends NodeDefinition>> children = plotEntity.getChildren();

		for (Node<? extends NodeDefinition> node : children) {
			if (node instanceof Attribute) {
				for (AbstractAttributeHandler handler : attributeHandlers) {
					if (handler.isAttributeParseable((Attribute) node)) {
						// builds ie. "text_parameter"
						String paramName = handler.getPrefix() + node.getName();

						// Saves into "collect_text_parameter"
						String collectParamName = COLLECT_PREFIX + paramName;
						if( parameters.get( collectParamName ) != null ){
							parameters.put(
									collectParamName,
									parameters.get(collectParamName) + " "
											+ handler.getAttributeFromParameter(paramName, plotEntity));
							
						}else{
							parameters.put(collectParamName, handler.getAttributeFromParameter(paramName, plotEntity));
						}
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
		Set<BeanDefinition> components = provider.findCandidateComponents("org/openforis/eye");
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

	public void saveToEntity(Map<String, String> parameters, Entity entity) {
		Set<String> parameterNames = parameters.keySet();
		for (String parameterName : parameterNames) {

			for (AbstractAttributeHandler handler : attributeHandlers) {
				if (handler.isParameterParseable(parameterName)) {
					handler.addToEntity(removePrefix(parameterName), parameters.get(parameterName), entity);
				}
			}
		}

	}

}

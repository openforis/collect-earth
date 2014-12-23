package org.openforis.collect.earth.app.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Set;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.handler.AbstractAttributeHandler;
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
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AssignableTypeFilter;
import org.springframework.stereotype.Component;

/**
 * 
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class CollectParametersHandlerService {

	public static final String PARAMETER_SEPARATOR = "===";

	private static final String COLLECT_PREFIX = "collect_";

	private final List<AbstractAttributeHandler> attributeHandlers = new ArrayList<AbstractAttributeHandler>();

	private final Logger logger = LoggerFactory.getLogger(CollectParametersHandlerService.class);

	@Autowired
	private RecordManager recordManager;

	@Autowired
	private ApplicationContext applicationContext;

	public CollectParametersHandlerService() {

	}

	private String cleanUpParameterName(String parameterName) {
		String cleanParameter = removeArraySuffix(parameterName);
		cleanParameter = removePrefix(cleanParameter);
		return cleanParameter;
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

							try {
								parameters.put(
										collectParamName,
										parameters.get(collectParamName) + PARAMETER_SEPARATOR
										+ handler.getAttributeFromParameter(paramName, plotEntity, index));
							} catch (Exception e) {
								logger.error("Exception when getting parameters for entity ", e);
							}

						} else {
							parameters.put(collectParamName, handler.getAttributeFromParameter(paramName, plotEntity));
						}

					} else if (node instanceof Entity) {
						Entity entity = (Entity) node;
						// result should be
						// collect_entity_NAME[KEY].code_attribute
						String entityKey = ((EntityHandler) handler).getEntityKey(entity);
						collectParamName += "[" + entityKey + "]";

						String cleanName = cleanUpParameterName(collectParamName);

						List<Node<? extends NodeDefinition>> entityChildren = entity.getChildren();
						int index =0;
						Integer lastChildId = null;
						for (Node<? extends NodeDefinition> child : entityChildren) {

							if( lastChildId == null || !lastChildId.equals( child.getDefinition().getId())){
								lastChildId = child.getDefinition().getId();
								index = 0;
							}
							
							for (AbstractAttributeHandler<?> handlerEntityAttribute : attributeHandlers) {
								try {
									if (handlerEntityAttribute.isParseable(child)) {
										handleMultipleParamaterValues(parameters, collectParamName, entity, child, handlerEntityAttribute, index );
										break;
									}
								} catch (Exception e) {
									logger.error("Error while parsing parameter " + cleanName + " with value " + parameters.toString(), e);
								}
							}	
							
							index++;
						}
					}
				}
			}
		}
		return parameters;
	}

	private void handleMultipleParamaterValues(Map<String, String> parameters, String collectParamName, Entity entity, Node<? extends NodeDefinition> child, AbstractAttributeHandler cah, int index) {
		String attributeValue = cah.getAttributeFromParameter(child.getName(), entity, index);
		if(!StringUtils.isBlank( attributeValue ) ){
			String previousValue = parameters.get(collectParamName + "." + cah.getPrefix() + child.getName());
			if( previousValue !=null ){
				parameters.put(collectParamName + "." + cah.getPrefix() + child.getName(), previousValue + PARAMETER_SEPARATOR + attributeValue );
			}else{
				parameters.put(collectParamName + "." + cah.getPrefix() + child.getName(), attributeValue);
			}
		}
	}


	@PostConstruct
	private void initiliaze() {
		ClassPathScanningCandidateComponentProvider provider = new ClassPathScanningCandidateComponentProvider(false);
		provider.addIncludeFilter(new AssignableTypeFilter(AbstractAttributeHandler.class));

		logger.info("Scanning for classes that can interpret collect attributes");
		// scan in org.example.package
		Set<BeanDefinition> components = provider.findCandidateComponents("org/openforis/collect/earth/app/service/handler");
		for (BeanDefinition component : components) {
			try {
				Class cls = Class.forName(component.getBeanClassName());
				// AbstractAttributeHandler attHandler = (AbstractAttributeHandler) cls.getConstructor().newInstance();
				AbstractAttributeHandler attHandler = (AbstractAttributeHandler) applicationContext.getBean(cls);
				attributeHandlers.add(attHandler);
			} catch (Exception e) {
				logger.error("Error when trying to initlize AttributeHandler" + component.getBeanClassName(), e);
			}

		}
		if (attributeHandlers.size() == 0) {
			logger.error("No attribute handlers defined. It is not possible to use the Collect parameter handler without implementations of AbstractAttributeHandler");
		}
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

	private String removePrefix(String parameterName) {
		if( parameterName.startsWith(COLLECT_PREFIX) ){
			return parameterName.substring(COLLECT_PREFIX.length());
		}else{
			return parameterName;
		}
	}

	public void saveToEntity(Map<String, String> parameters, Entity entity) {
		Set<Entry<String, String>> parameterEntries = parameters.entrySet();

		for (Entry<String, String> entry : parameterEntries) {
			String parameterValue = entry.getValue();
			String cleanName = cleanUpParameterName(entry.getKey());

			
			for (AbstractAttributeHandler<?> handler : attributeHandlers) {
				try {
					if (handler.isParameterParseable(cleanName)) {

						if( handler.isMultiValueAware() ){ // EntityHandler will use the original separated parameter values while the other will take single values
							handler.addOrUpdate(cleanName, parameterValue, entity, 0);
						}else{
							String[] parameterValues = parameterValue.split(CollectParametersHandlerService.PARAMETER_SEPARATOR);
							int index = 0; 
							for (String parameterVal : parameterValues) {
								handler.addOrUpdate(cleanName, parameterVal, entity, index);
								index++;
							}
						}

						break;
					}
				} catch (Exception e) {
					logger.error("Error while parsing parameter " + cleanName + " with value " + parameterValue, e);
				}
			}
			
		}
	}

	public String findValueForParameter(Map<String, String> parameters, String keyName) {
				
		if( parameters.containsKey( keyName ) ){ // In case the parameter contains the name of the key without the usuarl prefix i.e. collect_text_
			return parameters.get(keyName);
		}
		
		for (AbstractAttributeHandler<?> handler : attributeHandlers) {
			try {
				String possibleKey = COLLECT_PREFIX + handler.getPrefix() + keyName;
				if( parameters.containsKey( possibleKey )){
					return parameters.get(possibleKey);
				}
				
			} catch (Exception e) {
				logger.error("Error while finding value for parameter " + keyName , e);
			}
		}
		return null;
		
	}

}

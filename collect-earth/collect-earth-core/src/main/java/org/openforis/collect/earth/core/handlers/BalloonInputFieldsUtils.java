package org.openforis.collect.earth.core.handlers;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.model.NodeChangeMap;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.CodeList;
import org.openforis.idm.metamodel.CodeListItem;
import org.openforis.idm.metamodel.CodeListService;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NodeDefinitionVisitor;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.Node;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class BalloonInputFieldsUtils {

	public static final String PARAMETER_SEPARATOR = "===";

	private static final String COLLECT_PREFIX = "collect_";
	private final Logger logger = LoggerFactory.getLogger(BalloonInputFieldsUtils.class);

	private final List<AbstractAttributeHandler<?>> handlers = Arrays.<AbstractAttributeHandler<?>>asList(
			new BooleanAttributeHandler(),
			new CodeAttributeHandler(),
			new CoordinateAttributeHandler(),
			new DateAttributeHandler(),
			new EntityHandler(this),
			new IntegerAttributeHandler(),
			new RealAttributeHandler(),
			new TextAttributeHandler()
		);
	
	private AbstractAttributeHandler<?> findHandler(String parameterName) {
		for (AbstractAttributeHandler<?> handler : handlers) {
			if (handler.isParameterParseable(parameterName)) {
				return handler;
			}
		}
		throw new IllegalArgumentException("Handler not found for the given parameter name: " + parameterName);
	}

	private AbstractAttributeHandler<?> findHandler(Node<?> node) {
		return findHandler(node.getDefinition());
	}

	private AbstractAttributeHandler<?> findHandler(NodeDefinition def) {
		for (AbstractAttributeHandler<?> handler : handlers) {
			if (handler.isParseable(def)) {
				return handler;
			}
		}
		throw new IllegalArgumentException("Handler not found for the given node type: " + def.getClass().getName());
	}
	
	private String cleanUpParameterName(String parameterName) {
		String cleanParameter = removeArraySuffix(parameterName);
		cleanParameter = removePrefix(cleanParameter);
		return cleanParameter;
	}

	public Map<String, String> getValuesByHtmlParameters(Entity plotEntity) {
		Map<String, String> valuesByHTMLParameterName = new HashMap<String, String>();
		
		List<Node<? extends NodeDefinition>> children = plotEntity.getChildren();

		for (Node<? extends NodeDefinition> node : children) {
			AbstractAttributeHandler<?> handler = findHandler(node);
			getHTMLParameterName(plotEntity, valuesByHTMLParameterName,  node, handler);
		}
		return valuesByHTMLParameterName;
	}
	
	public Map<NodeDefinition, String> getHtmlParameterNameByNodeDef(final EntityDefinition rootEntity) {
		final CodeListService codeListService = rootEntity.getSurvey().getContext().getCodeListService();

		final Map<NodeDefinition, String> htmlParameterNameByNodeDef = new HashMap<NodeDefinition, String>();
		
		rootEntity.traverse(new NodeDefinitionVisitor() {
			public void visit(NodeDefinition def) {
				if (def instanceof AttributeDefinition) {
					EntityDefinition parentDef = def.getParentEntityDefinition();
					if (parentDef == rootEntity) {
						String collectParamName = getCollectParameterBaseName(def);
						htmlParameterNameByNodeDef.put(def, collectParamName);
					} else {
						CodeAttributeDefinition keyCodeAttribute = parentDef.getEnumeratingKeyCodeAttribute();
						if (keyCodeAttribute == null) {
							throw new IllegalStateException("Enumerating code attribute expected for entity " + parentDef.getPath());
						}
						CodeList enumeratingList = keyCodeAttribute.getList();
						List<CodeListItem> enumeratingItems = codeListService.loadRootItems(enumeratingList);
						for (CodeListItem enumeratingItem : enumeratingItems) {
							String collectParameterBaseName = getCollectParameterBaseName(parentDef) + "[" + enumeratingItem.getCode() + "]";
							
							List<NodeDefinition> childDefs = parentDef.getChildDefinitions();
							for (NodeDefinition childDef : childDefs) {
								AbstractAttributeHandler<?> childHandler = findHandler(childDef);
								String collectParameterName = collectParameterBaseName + childHandler.getPrefix() + childDef.getName();
								htmlParameterNameByNodeDef.put(childDef, collectParameterName);
							}
						}
					}
				}
			}
		});
		return htmlParameterNameByNodeDef;
	}
	
	private String getCollectParameterBaseName(NodeDefinition def) {
		AbstractAttributeHandler<?> handler = findHandler(def);

		// builds ie. "text_parameter"
		String paramName = handler.getPrefix() + def.getName();

		// Saves into "collect_text_parameter"
		return COLLECT_PREFIX + paramName;
	}

	protected void getHTMLParameterName(Entity plotEntity, Map<String,String> valuesByHtmlParameterName,
			Node<? extends NodeDefinition> node,
			AbstractAttributeHandler<?> handler) {
		// builds ie. "text_parameter"
		String paramName = handler.getPrefix() + node.getName();

		// Saves into "collect_text_parameter"
		String collectParamName = COLLECT_PREFIX + paramName;
		if (node instanceof Attribute) {
			if (valuesByHtmlParameterName.get(collectParamName) != null) {

				int index = StringUtils.countMatches(valuesByHtmlParameterName.get(collectParamName), PARAMETER_SEPARATOR) + 1;

				try {
					valuesByHtmlParameterName.put(
							collectParamName,
							valuesByHtmlParameterName.get(collectParamName) + PARAMETER_SEPARATOR
							+ handler.getAttributeFromParameter(paramName, plotEntity, index));
				} catch (Exception e) {
					logger.error("Exception when getting parameters for entity ", e);
				}

			} else {
				valuesByHtmlParameterName.put(collectParamName, handler.getAttributeFromParameter(paramName, plotEntity));
			}

		} else if (node instanceof Entity) {
			Entity entity = (Entity) node;
			// result should be
			// collect_entity_NAME[KEY].code_attribute
			String entityKey = ((EntityHandler) handler).getEntityKey(entity);
			collectParamName += "[" + entityKey + "]";

			List<Node<? extends NodeDefinition>> entityChildren = entity.getChildren();
			int index =0;
			Integer lastChildId = null;
			for (Node<? extends NodeDefinition> child : entityChildren) {

				if( lastChildId == null || !lastChildId.equals( child.getDefinition().getId())){
					lastChildId = child.getDefinition().getId();
					index = 0;
				}
				
				AbstractAttributeHandler<?> handlerEntityAttribute = findHandler(child);
				String parameterName = getMultipleParameterName( collectParamName, child, handlerEntityAttribute );
				String parameterValue = getMultipleParameterValue(child,handlerEntityAttribute, entity, index);
				if(!StringUtils.isBlank( parameterValue ) ){
					
					String previousValue = valuesByHtmlParameterName.get(parameterName);
					if( previousValue !=null ){
						valuesByHtmlParameterName.put(parameterName, previousValue + PARAMETER_SEPARATOR + parameterValue );
					}else{
						valuesByHtmlParameterName.put(parameterName, parameterValue);
					}
				}
				
				index++;
			}
		}
	}

	private String getMultipleParameterValue(Node<?> child, AbstractAttributeHandler<?> cah, Entity entity, int index) {
		return cah.getAttributeFromParameter(child.getName(), entity, index);
		
	}

	private String getMultipleParameterName( String collectParamName, 
			Node<?> child, AbstractAttributeHandler<?> cah ) {
		
		return collectParamName + "." + cah.getPrefix() + child.getName();
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

	public NodeChangeSet saveToEntity(Map<String, String> parameters, Entity entity) {
		NodeChangeMap result = new NodeChangeMap();
		
		Set<Entry<String, String>> parameterEntries = parameters.entrySet();

		for (Entry<String, String> entry : parameterEntries) {
			String parameterValue = entry.getValue();
			String cleanName = cleanUpParameterName(entry.getKey());

			AbstractAttributeHandler<?> handler = findHandler(cleanName);
			try {
				if( handler.isMultiValueAware() ){ // EntityHandler will use the original separated parameter values while the other will take single values
					NodeChangeSet partialChangeSet = handler.addOrUpdate(cleanName, parameterValue, entity, 0);
					result.addMergeChanges(partialChangeSet);
				}else{
					String[] parameterValues = parameterValue.split(BalloonInputFieldsUtils.PARAMETER_SEPARATOR);
					int index = 0; 
					for (String parameterVal : parameterValues) {
						NodeChangeSet partialChangeSet = handler.addOrUpdate(cleanName, parameterVal, entity, index);
						result.addMergeChanges(partialChangeSet);
						index++;
					}
				}
				break;
			} catch (Exception e) {
				logger.error("Error while parsing parameter " + cleanName + " with value " + parameterValue, e);
			}
		}
		return result;
	}

}

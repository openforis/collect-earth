package org.openforis.collect.earth.core.handlers;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Queue;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.core.model.PlacemarkCodedItem;
import org.openforis.collect.earth.core.model.PlacemarkInputFieldInfo;
import org.openforis.collect.earth.core.utils.CollectSurveyUtils;
import org.openforis.collect.metamodel.ui.UIConfiguration;
import org.openforis.collect.metamodel.ui.UIField;
import org.openforis.collect.metamodel.ui.UIFormComponent;
import org.openforis.collect.metamodel.ui.UIFormContentContainer;
import org.openforis.collect.metamodel.ui.UIFormSection;
import org.openforis.collect.metamodel.ui.UIFormSet;
import org.openforis.collect.metamodel.ui.UITable;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.NodeChangeMap;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.collect.model.RecordValidationReportGenerator;
import org.openforis.collect.model.RecordValidationReportItem;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.CodeList;
import org.openforis.idm.metamodel.CodeListItem;
import org.openforis.idm.metamodel.CodeListService;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.ModelVersion;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NodeDefinitionVisitor;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.Node;
import org.openforis.idm.path.Path;
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
	public static final String MULTIPLE_VALUES_SEPARATOR = ";";
	private static final Pattern PARAMETER_PART_PATTERN = Pattern.compile("^(\\w+)(\\[(\\w+)\\])?$");
	
	private static final String NOT_APPLICABLE_ITEM_CODE = "-1";
	private static final String NOT_APPLICABLE_ITEM_LABEL = "N/A";
	private static final int MAX_MULTIPLE_ENTITIES_COUNT = 10;

	private static final String COLLECT_PREFIX = "collect_";
	private final Logger logger = LoggerFactory.getLogger(BalloonInputFieldsUtils.class);

	private final List<AbstractAttributeHandler<?>> handlers = Arrays.<AbstractAttributeHandler<?>>asList(
			new BooleanAttributeHandler(), new CodeAttributeHandler(), new CoordinateAttributeHandler(),
			new DateAttributeHandler(), new EntityHandler(this), new IntegerAttributeHandler(),
			new RangeAttributeHandler(), new RealAttributeHandler(), new TextAttributeHandler(),
			new TimeAttributeHandler());

	public LinkedHashMap<String, PlacemarkInputFieldInfo> extractFieldInfoByParameterName(CollectRecord record,
			NodeChangeSet changeSet, String language, String modelVersionName) {
		Collection<AttributeDefinition> changedDefs = extractChangedAttributeDefinitions(record, changeSet);
		LinkedHashMap<String, String> htmlParameterNameByNodePath = generateAttributeHtmlParameterNameByNodePath(changedDefs);
		Set<String> parameterNames = new LinkedHashSet<>(htmlParameterNameByNodePath.values());
		Map<String, String> validationMessageByPath = generateValidationMessages(record);
		Entity rootEntity = record.getRootEntity();

		LinkedHashMap<String, PlacemarkInputFieldInfo> result = new LinkedHashMap<String, PlacemarkInputFieldInfo>(
				parameterNames.size());
		for (String parameterName : parameterNames) {
			String cleanName = cleanUpParameterName(parameterName);
			AbstractAttributeHandler<?> handler = findHandler(cleanName);
			if (handler == null) {
				logger.warn("Cannot find handler for parameter: ", parameterName);
			} else if (handler instanceof EntityHandler) {
				EntityHandler entityHandler = (EntityHandler) handler;
				Entity currentEntity = entityHandler.getChildEntity(cleanName, rootEntity);
				if (currentEntity != null) {
					String childAttributeParameterName = entityHandler
							.extractNestedAttributeParameterName(parameterName);
					AbstractAttributeHandler<?> childHandler = findHandler(childAttributeParameterName);
					if (childHandler != null) {
						PlacemarkInputFieldInfo info = generateAttributeFieldInfo(record, validationMessageByPath,
								currentEntity, childAttributeParameterName, childHandler, language, modelVersionName);
						result.put(parameterName, info);
					}
				}
			} else {
				PlacemarkInputFieldInfo info = generateAttributeFieldInfo(record, validationMessageByPath, rootEntity,
						cleanName, handler, language, modelVersionName);
				result.put(parameterName, info);
			}
		}
		return result;
	}

	private Set<AttributeDefinition> extractChangedAttributeDefinitions(CollectRecord record, NodeChangeSet changeSet) {
		if (changeSet == null) {
			return extractAttributeDefinitions(record);
		} else {
			Set<AttributeDefinition> changedDefs = new HashSet<>();
			Set<Node<?>> changedNodes = changeSet.getChangedNodes();
			for (Node<?> node : changedNodes) {
				if (node instanceof Attribute) {
					changedDefs.add((AttributeDefinition) node.getDefinition());
				}
			}
			Set<CodeAttributeDefinition> relatedParentCodeDefs = new HashSet<>();
			for (AttributeDefinition changedDef : changedDefs) {
				if (changedDef instanceof CodeAttributeDefinition) {
					relatedParentCodeDefs
							.addAll(((CodeAttributeDefinition) changedDef).getAncestorCodeAttributeDefinitions());
				}
			}
			changedDefs.addAll(relatedParentCodeDefs);
			return changedDefs;
		}
	}

	private PlacemarkInputFieldInfo generateAttributeFieldInfo(CollectRecord record,
			Map<String, String> validationMessageByPath, Entity rootEntity, String cleanName,
			AbstractAttributeHandler<?> handler, String language, String modelVersionName) {

		PlacemarkInputFieldInfo info = new PlacemarkInputFieldInfo();

		ModelVersion recordVersion = record.getSurvey().getVersion(modelVersionName);
		List<Attribute<?, ?>> attributes = handler.getAttributeNodesFromParameter(cleanName, rootEntity);
		Attribute<?, ?> firstAttribute = attributes.get(0);

		String value = handler.getValueFromParameter(cleanName, rootEntity);

		info.setValue(value);
		info.setVisible(firstAttribute.isRelevant());

		AttributeDefinition attrDef = firstAttribute.getDefinition();
		String validationMessagePath;
		if (attrDef.isMultiple()) {
			validationMessagePath = firstAttribute.getParent().getPath() + Path.SEPARATOR + attrDef.getName();
		} else {
			validationMessagePath = firstAttribute.getPath();
		}

		String errorMessage = validationMessageByPath.get(validationMessagePath);
		if (errorMessage != null && firstAttribute.isRelevant()) {
			info.setInError(true);
			info.setErrorMessage(errorMessage);
		}
		if (firstAttribute instanceof CodeAttribute) {
			CodeListService codeListService = record.getSurveyContext().getCodeListService();
			List<CodeListItem> validCodeListItems = codeListService.loadValidItems(firstAttribute.getParent(),
					(CodeAttributeDefinition) attrDef);

			CodeListItem selectedCodeListItem = getCodeListItem(validCodeListItems, value);
			info.setCodeItemId(selectedCodeListItem == null ? null : selectedCodeListItem.getId());
			List<PlacemarkCodedItem> possibleCodedItems = new ArrayList<>(validCodeListItems.size() + 1);
			possibleCodedItems.add(new PlacemarkCodedItem(NOT_APPLICABLE_ITEM_CODE, NOT_APPLICABLE_ITEM_LABEL));

			if (validCodeListItems.isEmpty()) {
				info.setVisible(false);
			} else {
				for (CodeListItem item : validCodeListItems) {
					// Check that the code list item is available for the current record version
					if (recordVersion == null || recordVersion.isApplicable(item)) { // If the item is used on the
																						// current version used
						String label = item.getLabel(language, true);
						possibleCodedItems.add(new PlacemarkCodedItem(item.getCode(), label));
					}
				}
			}

			info.setPossibleCodedItems(possibleCodedItems);

		}
		return info;
	}

	private CodeListItem getCodeListItem(List<CodeListItem> items, String code) {
		for (CodeListItem item : items) {
			if (item.getCode().equals(code)) {
				return item;
			}
		}
		return null;
	}

	private Map<String, String> generateValidationMessages(CollectRecord record) {
		RecordValidationReportGenerator validationReportGenerator = new RecordValidationReportGenerator(record);
		List<RecordValidationReportItem> validationItems = validationReportGenerator.generateValidationItems();
		Map<String, String> validationMessageByPath = new HashMap<>(validationItems.size());
		for (RecordValidationReportItem validationItem : validationItems) {
			validationMessageByPath.put(validationItem.getPath(), validationItem.getMessage());
		}
		return validationMessageByPath;
	}

	private AbstractAttributeHandler<?> findHandler(String cleanParameterName) {
		for (AbstractAttributeHandler<?> handler : handlers) {
			if (handler.isParameterParseable(cleanParameterName)) {
				return handler;
			}
		}
		logger.warn("Handler not found for the given parameter name: ", cleanParameterName);
		return null;
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
		logger.warn("Handler not found for the given node type: " + def.getClass().getName());
		return null;
	}

	private String cleanUpParameterName(String parameterName) {
		String cleanParameter = removeArraySuffix(parameterName);
		cleanParameter = removePrefix(cleanParameter);
		return cleanParameter;
	}
	
	private List<ParameterPart> extractParameterParts(CollectSurvey survey, String cleanParameter) {
		EntityDefinition currentParentEntityDef = survey.getSchema().getFirstRootEntityDefinition();
		List<ParameterPart> result = new ArrayList<>();
		String[] splitted = cleanParameter.split("\\.");
		for (String part : splitted) {
			String cleanPart = removeTypePrefix(part);
			Matcher matcher = PARAMETER_PART_PATTERN.matcher(cleanPart);
			if (matcher.find()) {
				String childDefName = matcher.group(1);
				if (currentParentEntityDef.containsChildDefinition(childDefName)) {
					NodeDefinition childDef = currentParentEntityDef.getChildDefinition(childDefName);
					String indexStr = matcher.group(3);
					int index = indexStr == null ? 0: Integer.parseInt(indexStr);
					result.add(new ParameterPart(childDef, index));
					currentParentEntityDef = childDef instanceof EntityDefinition ? (EntityDefinition) childDef: null;
				} else {
					throw new IllegalStateException("Cannot find child definition " + childDefName + " inside entity " + currentParentEntityDef.getName());
				}
			} else {
				throw new IllegalStateException("Unable to parse parameter: " + cleanParameter);
			}
		}
		return result;
	}

	/**
	 * Returns a map of parameter names by node path, sorted following the order in which every field is shown in the UI.
	 * @param rootEntityDef The root entity definition.
	 * @return Sorted map of parameter names by node path.
	 */
	public LinkedHashMap<String, String> getHtmlParameterNameByNodePath(EntityDefinition rootEntityDef) {
		LinkedHashMap<String, String> result = new LinkedHashMap<>();

		CollectSurvey survey = rootEntityDef.getSurvey();
		UIConfiguration uiConfiguration = survey.getUIConfiguration();
		UIFormSet mainFormSet = uiConfiguration.getMainFormSet();
		
		Queue<UIFormContentContainer> queue = new LinkedList<>();
		queue.add(mainFormSet);
		
		while (!queue.isEmpty()) {
			UIFormContentContainer formSet = queue.poll();
			for (UIFormComponent uiFormComponent : formSet.getChildren()) {
				result.putAll(getHtmlParameterNameByNodePathPerComponent(rootEntityDef, uiFormComponent));
			}
			queue.addAll(formSet.getForms());
		}
		return result;
	}

	private Map<String, String> getHtmlParameterNameByNodePathPerComponent(
			EntityDefinition rootEntityDef, UIFormComponent uiFormComponent) {
		LinkedHashMap<String, String> result = new LinkedHashMap<>();

		CollectSurvey survey = rootEntityDef.getSurvey();
		CodeListService codeListService = survey.getContext().getCodeListService();
		
		if (uiFormComponent instanceof UIField) {
			AttributeDefinition attrDef = ((UIField) uiFormComponent).getAttributeDefinition();
			EntityDefinition parentDef = attrDef.getParentEntityDefinition();

			if (parentDef == rootEntityDef) {
				String collectParamName = getCollectParameterBaseName(attrDef);
				if (collectParamName != null) {
					result.put(attrDef.getPath(), collectParamName);
				}
			} else {
				throw new IllegalStateException("unexpected non-root parentDef for attribute: " + attrDef.getName());
			}
		} else if (uiFormComponent instanceof UITable) {
			EntityDefinition entityDef = ((UITable) uiFormComponent).getEntityDefinition();
			// multiple (enumerated) entity
			CodeAttributeDefinition keyCodeAttribute = entityDef.getEnumeratingKeyCodeAttribute();
			if (keyCodeAttribute != null) {
				String collectParameterBaseNamePrefix = getCollectParameterBaseName(entityDef);
				CodeList enumeratingList = keyCodeAttribute.getList();
				List<CodeListItem> enumeratingItems = codeListService.loadRootItems(enumeratingList);
				for (int i = 0; i < enumeratingItems.size(); i++) {
					CodeListItem enumeratingItem = enumeratingItems.get(i);
					String enumeratingItemCode = enumeratingItem.getCode();
					String collectParameterBaseName = collectParameterBaseNamePrefix + "[" + enumeratingItemCode + "].";
					result.putAll(getHtmlParameterNameByNodePathOfChildren(entityDef, collectParameterBaseName, i));
				}
			}
		} else if (uiFormComponent instanceof UIFormSection) {
			// single entity
			EntityDefinition entityDef = ((UIFormSection) uiFormComponent).getEntityDefinition();
			String collectParameterBaseNamePrefix = getCollectParameterBaseName(entityDef);
			String collectParameterBaseName = collectParameterBaseNamePrefix + (entityDef.isMultiple() ? "[$index]": "") + ".";
			result.putAll(getHtmlParameterNameByNodePathOfChildren(entityDef, collectParameterBaseName, null));
		}
		return result;
	}

	private LinkedHashMap<String, String> getHtmlParameterNameByNodePathOfChildren(EntityDefinition entityDef,
			String collectParameterBaseName, Integer parentEntityIndex) {
		final LinkedHashMap<String, String> result = new LinkedHashMap<>();
		String parentEntityIndexPathPart = "[" + (parentEntityIndex == null ? "$index" : (parentEntityIndex + 1)) + "]";
		for (NodeDefinition childDef : entityDef.getChildDefinitions()) {
			AbstractAttributeHandler<?> childHandler = findHandler(childDef);
			if (childHandler != null) {
				StringBuilder collectParameterNameSB = new StringBuilder();
				collectParameterNameSB.append(collectParameterBaseName);
				collectParameterNameSB.append(childHandler.getPrefix());
				collectParameterNameSB.append(childDef.getName());
				String collectParameterName = collectParameterNameSB.toString();
				
				StringBuilder nodePathSB = new StringBuilder();
				nodePathSB.append(entityDef.getPath());
				nodePathSB.append(parentEntityIndexPathPart);
				nodePathSB.append('/');
				nodePathSB.append(childDef.getName());
				String nodePath = nodePathSB.toString();
				
				result.put(nodePath, collectParameterName);
			}
		}
		return result;
	}
	
	public Map<String, String> getValuesByHtmlParameters(Entity plotEntity) {
		Map<String, String> valuesByHTMLParameterName = new HashMap<String, String>();

		List<Node<?>> children = plotEntity.getChildren();

		for (Node<?> node : children) {
			getHTMLParameterName(plotEntity, valuesByHTMLParameterName, node);
		}
		return valuesByHTMLParameterName;
	}

	private Set<AttributeDefinition> extractAttributeDefinitions(CollectRecord record) {
		final Set<AttributeDefinition> result = new LinkedHashSet<AttributeDefinition>();

		record.getRootEntity().getDefinition().traverse(new NodeDefinitionVisitor() {
			public void visit(NodeDefinition def) {
				if (def instanceof AttributeDefinition) {
					result.add((AttributeDefinition) def);
				}
			}
		});
		return result;
	}

	private LinkedHashMap<String, String> generateAttributeHtmlParameterNameByNodePath(Collection<AttributeDefinition> defs) {
		LinkedHashMap<String, String> result = new LinkedHashMap<>();
		for (AttributeDefinition def : defs) {
			result.putAll(generateAttributeHtmlParameterNameByNodePath(def));
		}
		return result;
	}

	private LinkedHashMap<String, String> generateAttributeHtmlParameterNameByNodePath(AttributeDefinition def) {
		LinkedHashMap<String, String> result = new LinkedHashMap<>();

		EntityDefinition parentDef = def.getParentEntityDefinition();
		if (parentDef.isRoot()) {
			String collectParamName = getCollectParameterBaseName(def);
			if (collectParamName != null) {
				result.put(def.getPath(), collectParamName);
			}
		} else {
			List<NodeDefinition> childDefs = parentDef.getChildDefinitions();
			if (parentDef.isMultiple()) {
				// multiple entity
				List<?> enumeratingItems;
				CodeAttributeDefinition keyCodeAttribute = parentDef.getEnumeratingKeyCodeAttribute();
				if (keyCodeAttribute != null) {
					// enumerated entity
					enumeratingItems = CollectSurveyUtils.getEnumeratingCodes(keyCodeAttribute);
				} else {
					enumeratingItems = IntStream.rangeClosed(1, MAX_MULTIPLE_ENTITIES_COUNT).boxed().collect(Collectors.toList());
				}
				for (int i = 0; i < enumeratingItems.size(); i++) {
					Object enumeratingItem = enumeratingItems.get(i);
					String collectParameterBaseName = getCollectParameterBaseName(parentDef) + "[" + enumeratingItem + "].";
					for (NodeDefinition childDef : childDefs) {
						AbstractAttributeHandler<?> childHandler = findHandler(childDef);
						if (childHandler != null) {
							String collectParameterName = collectParameterBaseName + childHandler.getPrefix()
									+ childDef.getName();
							String enumeratingItemPath = parentDef.getPath() + "[" + (i + 1) + "]/"
									+ childDef.getName();
							result.put(enumeratingItemPath, collectParameterName);
						}
					}
				}
			} else {
				// single entity
				String collectParameterBaseName = getCollectParameterBaseName(parentDef) + ".";
				for (NodeDefinition childDef : childDefs) {
					AbstractAttributeHandler<?> childHandler = findHandler(childDef);
					if (childHandler != null) {
						String collectParameterName = collectParameterBaseName + childHandler.getPrefix()
								+ childDef.getName();
						String nodePath = parentDef.getPath() + "/" + childDef.getName();
						result.put(nodePath, collectParameterName);
					}
				}
			}
		}
		return result;
	}

	private String getCollectParameterBaseName(NodeDefinition def) {
		AbstractAttributeHandler<?> handler = findHandler(def);

		if (handler != null) {
			// builds ie. "text_parameter"
			String paramName = handler.getPrefix() + def.getName();

			// Saves into "collect_text_parameter"
			return COLLECT_PREFIX + paramName;
		} else {
			return null;
		}
	}

	public String getCollectBalloonParamName(NodeDefinition node) {
		AbstractAttributeHandler<?> handler = findHandler(node);

		if (handler == null) {
			throw new IllegalArgumentException("No handler found for node " + node.getName());
		}

		// builds ie. "text_parameter"
		String paramName = handler.getPrefix() + node.getName();

		// Saves into "collect_text_parameter"
		return COLLECT_PREFIX + paramName;
	}

	protected void getHTMLParameterName(Entity plotEntity, Map<String, String> valuesByHtmlParameterName,
			Node<?> node) {

		AbstractAttributeHandler<?> handler = findHandler(node);

		if (handler == null) {
			throw new IllegalArgumentException(
					"No handler found for node " +  node.getName() );
		}

		// builds ie. "text_parameter"
		String paramName = handler.getPrefix() + node.getName();

		// Saves into "collect_text_parameter"
		String collectParamName = COLLECT_PREFIX + paramName;

		if (node instanceof Attribute) {
			String value = valuesByHtmlParameterName.get(collectParamName);
			if (value == null) {
				valuesByHtmlParameterName.put(collectParamName,
						handler.getValueFromParameter(paramName, plotEntity, 0));
			} else {
				int index = StringUtils.countMatches(value, PARAMETER_SEPARATOR) + 1;
				try {
					String newValue = value + PARAMETER_SEPARATOR
							+ handler.getValueFromParameter(paramName, plotEntity, index);
					valuesByHtmlParameterName.put(collectParamName, newValue);
				} catch (Exception e) {
					logger.warn("Attribute " + node);
					logger.warn("With value " + value);
					logger.error("Exception when getting parameters for entity ", e);
				}
			}

		} else if (node instanceof Entity) {
			Entity entity = (Entity) node;
			List<Node<?>> entityChildren = entity.getChildren();

			EntityDefinition entityDef = entity.getDefinition();
			if (entityDef.isMultiple()) {
				if (entityDef.isEnumerable()) {
					// result should be
					// collect_entity_NAME[KEY].code_attribute
					@SuppressWarnings("deprecation")
					String entityKey = entity.getKeyValues()[0];
					collectParamName += "[" + entityKey + "]";
				} else {
					collectParamName += "[" + (node.getIndex() + 1) + "]";
				}
			}

			for (Node<?> child : entityChildren) {
				AbstractAttributeHandler<?> handlerEntityAttribute = findHandler(child);
				String parameterName = getMultipleParameterName(collectParamName, child, handlerEntityAttribute);
				String parameterValue = getMultipleParameterValue(child, handlerEntityAttribute, entity);
				if (StringUtils.isNotBlank(parameterValue)) {
					valuesByHtmlParameterName.put(parameterName, parameterValue);
				}
			}
		}
	}

	private String getMultipleParameterValue(Node<?> child, AbstractAttributeHandler<?> cah, Entity entity) {
		return cah.getValueFromParameter(cah.getPrefix() + child.getName(), entity);
	}

	private String getMultipleParameterName(String collectParamName, Node<?> child, AbstractAttributeHandler<?> cah) {

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
		if (parameterName.startsWith(COLLECT_PREFIX)) {
			return parameterName.substring(COLLECT_PREFIX.length());
		} else {
			return parameterName;
		}
	}
	
	private String removeTypePrefix(String cleanParameterName) {
		int indexOfUnderscore = cleanParameterName.indexOf('_');
		return cleanParameterName.substring(indexOfUnderscore + 1);
	}

	public NodeChangeSet saveToEntity(Map<String, String> parameters, Entity entity) {
		return saveToEntity(parameters, entity, false);
	}

	public NodeChangeSet saveToEntity(Map<String, String> parameters, Entity entity, boolean newRecord) {
		CollectSurvey survey = (CollectSurvey) entity.getSurvey();
		List<Entry<String, String>> sortedParameters = new ArrayList<>(parameters.entrySet()); 
//				entity.isRoot() ? sortParameters(survey, parameters): new ArrayList<>(parameters.entrySet());
		
		final NodeChangeMap result = new NodeChangeMap();

		for (Entry<String, String> parameter: sortedParameters) {
			String parameterName = parameter.getKey();
			String parameterValue = parameter.getValue();
			if (parameterValue.contains("$")) {
				continue;
			}
			String cleanName = cleanUpParameterName(parameterName);

			AbstractAttributeHandler<?> handler = findHandler(cleanName);
			if (handler != null) {
				try {
					// update attribute value only the record is not new or the value is not null
					// (e.g. from CSV)
					// otherwise default values or calculated attributes can be overwritten
					if (!newRecord || StringUtils.isNotBlank(parameterValue)) {
						if (handler.isMultiValueAware()) { // EntityHandler will use the original separated parameter
															// values while the other will take single values
							NodeChangeSet partialChangeSet = handler.addOrUpdate(cleanName, parameterValue, entity, 0);
							result.addMergeChanges(partialChangeSet);
						} else {
							String[] parameterValues = parameterValue
									.split(BalloonInputFieldsUtils.PARAMETER_SEPARATOR);
							NodeChangeSet partialChangeSet = handler.updateMultipleAttribute(cleanName, entity,
									parameterValues);
							result.addMergeChanges(partialChangeSet);
						}
					}
				} catch (Exception e) {
					logger.error("Error while parsing parameter " + cleanName + " with value " + parameterValue, e);
				}
			} else {
				logger.error("Handler not found for parameter: ", cleanName);
			}
		}
		return result;
	}

	public Attribute<?, ?> getAttributeNodeFromParameter(Entity entity, String parameterName, int index) {
		String cleanName = cleanUpParameterName(parameterName);
		AbstractAttributeHandler<?> handler = findHandler(cleanName);
		return handler.getAttributeNodeFromParameter(cleanName, entity, index);
	}
	
	private List<Entry<String, String>> sortParameters(CollectSurvey survey, Map<String, String> parameters) {
		List<NodeDefinition> sortedDefs = new ArrayList<>();
		survey.getSchema().getFirstRootEntityDefinition().traverse(new NodeDefinitionVisitor() {
			public void visit(NodeDefinition nodeDef) {
				sortedDefs.add(nodeDef);
			}
		});

		Map<String, List<ParameterPart>> parameterPartsByName = new HashMap<>();
		for (Entry<String, String> entry : parameters.entrySet()) {
			String parameterName = entry.getKey();
			String cleanName = cleanUpParameterName(parameterName);
			List<ParameterPart> parts = extractParameterParts(survey, cleanName);
			parameterPartsByName.put(parameterName, parts);
		}
		
		Set<Entry<String, String>> entrySet = parameters.entrySet();
		for (Entry<String, String> entry : entrySet) {
			
		}
		List<Entry<String, String>> sortedParameters = new ArrayList<>(parameters.entrySet());
		sortedParameters.sort(new Comparator<Entry<String, String>>() {
			public int compare(Entry<String, String> param1, Entry<String, String> param2) {
				String name1 = param1.getKey();
				String name2 = param2.getKey();
				List<ParameterPart> parts1 = parameterPartsByName.get(name1);
				List<ParameterPart> parts2 = parameterPartsByName.get(name2);
				int depthDiff = parts1.size() - parts2.size();
				if (depthDiff != 0) return depthDiff;
				
				for (int i = 0; i < parts1.size(); i++) {
					ParameterPart part1 = parts1.get(i);
					ParameterPart part2 = parts2.get(i);
					int defIndex1 = sortedDefs.indexOf(part1.nodeDefinition);
					int defIndex2 = sortedDefs.indexOf(part2.nodeDefinition);
					int defIndexDiff = defIndex1 - defIndex2;
					if (defIndexDiff != 0) {
						return defIndexDiff;
					}
					int nodeIndexDiff = part1.index - part2.index;
					if (nodeIndexDiff != 0) {
						return nodeIndexDiff;
					}
				}
				return 0;
			}
		});
		return sortedParameters;
	}

	private class ParameterPart {
		private NodeDefinition nodeDefinition;
		private int index;
		
		ParameterPart(NodeDefinition nodeDefinition, int index) {
			this.nodeDefinition = nodeDefinition;
			this.index = index;
		}
	}
}

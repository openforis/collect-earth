package org.openforis.collect.earth.app.service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.core.handlers.BalloonInputFieldsUtils;
import org.openforis.collect.metamodel.CollectAnnotations;
import org.openforis.collect.metamodel.ui.UIConfiguration;
import org.openforis.collect.metamodel.ui.UIField;
import org.openforis.collect.metamodel.ui.UIForm;
import org.openforis.collect.metamodel.ui.UIFormComponent;
import org.openforis.collect.metamodel.ui.UIFormContentContainer;
import org.openforis.collect.metamodel.ui.UIFormSection;
import org.openforis.collect.metamodel.ui.UIFormSet;
import org.openforis.collect.metamodel.ui.UIOptions;
import org.openforis.collect.metamodel.ui.UIOptions.CodeAttributeLayoutType;
import org.openforis.collect.metamodel.ui.UITable;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.BooleanAttributeDefinition;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.CodeList;
import org.openforis.idm.metamodel.CodeListItem;
import org.openforis.idm.metamodel.CoordinateAttributeDefinition;
import org.openforis.idm.metamodel.DateAttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.ModelVersion;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NodeLabel.Type;
import org.openforis.idm.metamodel.NumberAttributeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition;
import org.openforis.idm.metamodel.TextAttributeDefinition;
import org.openforis.idm.metamodel.TimeAttributeDefinition;
import org.openforis.idm.metamodel.Unit;
import org.openforis.idm.metamodel.VersionableSurveyObject;

/**
 * Describes the data entry form of a Collect Earth survey as JSON-ready maps and lists, so that the
 * web form (src/main/frontend, form.html) can be generated at runtime from the survey Collect Earth has
 * loaded, instead of from the balloon.html that the Collect Survey Designer writes into the CEP.
 *
 * <p>It follows the rules of Collect's CollectEarthBalloonGenerator, so a survey looks the same in both:
 * one tab per form of the main form set; the built-in, hidden, key and "from CSV" attributes are left out
 * of the tabs; single entities become groups and enumerated multiple entities become tables. The fields
 * carry the same parameter names as the balloon ({@link BalloonInputFieldsUtils}), so the form saves through
 * the existing placemark-info-expanded / save-data-expanded endpoints. Relevance, validation, default and
 * calculated values stay on the server, which returns them with every save.</p>
 *
 * <p>Unlike the balloon, the labels are in the language asked for (falling back to the survey default
 * language), so a survey shows in the Collect Earth UI language when it has been translated.</p>
 */
public class SurveyFormModelBuilder {

	/** Root attributes that Collect Earth fills itself and the balloon never shows. */
	static final Set<String> BUILT_IN_ATTRIBUTE_NAMES = new HashSet<>(
			Arrays.asList("operator", "location", "plot_file", "actively_saved", "actively_saved_on"));

	private static final String COLLECT_PREFIX = "collect_";

	private final CollectSurvey survey;
	private final String language;
	private final String defaultLanguage;
	private final ModelVersion version;
	private final CollectAnnotations annotations;
	private final UIOptions uiOptions;
	private final BalloonInputFieldsUtils balloonUtils = new BalloonInputFieldsUtils();
	private final List<Map<String, Object>> unsupported = new ArrayList<>();

	public SurveyFormModelBuilder(CollectSurvey survey, String language, String modelVersionName) {
		this.survey = survey;
		this.defaultLanguage = survey.getDefaultLanguage();
		this.language = StringUtils.isBlank(language) ? defaultLanguage : language.toLowerCase();
		this.version = StringUtils.isBlank(modelVersionName) ? null : survey.getVersion(modelVersionName);
		this.annotations = survey.getAnnotations();
		this.uiOptions = survey.getUIOptions();
	}

	public Map<String, Object> build() {
		EntityDefinition rootDef = survey.getSchema().getFirstRootEntityDefinition();
		Map<String, Object> model = new LinkedHashMap<>();
		model.put("survey", survey.getName());
		model.put("language", language);

		List<String> keys = new ArrayList<>();
		for (AttributeDefinition keyDef : rootDef.getKeyAttributeDefinitions()) {
			keys.add(parameterName(keyDef));
		}
		model.put("keys", keys);
		// Values the form has to send with every save, and where each one comes from in the plot CSV.
		// SurveyFormPlotValues fills them per plot: the KML template does the same with $[EXTRA_...].
		List<String> csvFields = new ArrayList<>();
		for (AttributeDefinition def : survey.getExtendedDataFields()) {
			if (handled(def)) {
				csvFields.add(parameterName(def));
			}
		}
		model.put("csvFields", csvFields);

		List<Map<String, Object>> tabs = new ArrayList<>();
		UIConfiguration uiConfiguration = survey.getUIConfiguration();
		UIFormSet formSet = uiConfiguration == null ? null : uiConfiguration.getMainFormSet();
		if (formSet == null || formSet.getForms().isEmpty()) {
			// No form layout in the survey: one tab with every root child, like the balloon generator
			Map<String, Object> tab = new LinkedHashMap<>();
			tab.put("id", rootDef.getName());
			tab.put("label", label(rootDef));
			tab.put("items", schemaItems(rootDef));
			tabs.add(tab);
		} else {
			for (UIForm form : formSet.getForms()) {
				addFormTabs(form, null, tabs);
			}
		}
		model.put("tabs", tabs);
		model.put("unsupported", unsupported);
		return model;
	}

	/** A form is a tab; nested forms (sub-tabs) follow it as tabs of their own, so none of their fields is lost. */
	private void addFormTabs(UIForm form, String parentLabel, List<Map<String, Object>> tabs) {
		String formLabel = StringUtils.defaultIfBlank(form.getLabel(language, defaultLanguage), "Tab " + (tabs.size() + 1));
		String tabLabel = parentLabel == null ? formLabel : parentLabel + " › " + formLabel;
		Map<String, Object> tab = new LinkedHashMap<>();
		tab.put("id", "tab_" + form.getId());
		tab.put("label", tabLabel);
		List<Map<String, Object>> items = new ArrayList<>();
		if (form.isMultipleEntityForm()) {
			Map<String, Object> multiple = multipleEntityItem(form.getMultipleEntityDefinition());
			if (multiple != null) {
				items.add(multiple);
			}
		} else {
			addContainerItems(form, items);
		}
		tab.put("items", items);
		if (!items.isEmpty()) {
			tabs.add(tab);
		}
		for (UIForm child : form.getForms()) {
			addFormTabs(child, tabLabel, tabs);
		}
	}

	private void addContainerItems(UIFormContentContainer container, List<Map<String, Object>> items) {
		for (UIFormComponent component : container.getChildren()) {
			if (component instanceof UIField) {
				UIField uiField = (UIField) component;
				AttributeDefinition def = uiField.getAttributeDefinition();
				if (uiField.isHidden()) {
					continue;
				}
				Map<String, Object> item = rootAttributeItem(def);
				if (item != null) {
					items.add(item);
				}
			} else if (component instanceof UITable) {
				addEntityItem(((UITable) component).getEntityDefinition(), items);
			} else if (component instanceof UIFormSection) {
				UIFormSection section = (UIFormSection) component;
				EntityDefinition entityDef = section.getEntityDefinition();
				if (entityDef == null) {
					// a section that only groups fields of the parent entity
					addContainerItems(section, items);
				} else {
					addEntityItem(entityDef, items);
				}
			}
		}
	}

	/** Every root child, in schema order, for surveys without a form layout. */
	private List<Map<String, Object>> schemaItems(EntityDefinition rootDef) {
		List<Map<String, Object>> items = new ArrayList<>();
		for (NodeDefinition childDef : rootDef.getChildDefinitions()) {
			if (!available(childDef) || uiOptions.isHidden(childDef)) {
				continue;
			}
			if (childDef instanceof AttributeDefinition) {
				Map<String, Object> item = rootAttributeItem((AttributeDefinition) childDef);
				if (item != null) {
					items.add(item);
				}
			} else {
				addEntityItem((EntityDefinition) childDef, items);
			}
		}
		return items;
	}

	/** A field of the root entity, an "info" line for header data, or null when the balloon would not show it. */
	private Map<String, Object> rootAttributeItem(AttributeDefinition def) {
		if (!available(def)) {
			return null;
		}
		boolean fromCsv = annotations.isFromCollectEarthCSV(def);
		boolean showReadOnly = fromCsv && annotations.isShowReadOnlyFieldInCollectEarth(def);
		if (BUILT_IN_ATTRIBUTE_NAMES.contains(def.getName()) || def.isKey() || fromCsv && !showReadOnly) {
			if (annotations.isIncludedInCollectEarthHeader(def) && handled(def)) {
				Map<String, Object> info = new LinkedHashMap<>();
				info.put("kind", "info");
				info.put("name", parameterName(def));
				info.put("label", label(def));
				return info;
			}
			return null;
		}
		Map<String, Object> field = field(def, parameterName(def));
		if (field != null && showReadOnly) {
			field.put("readOnly", true);
		}
		return field;
	}

	private void addEntityItem(EntityDefinition entityDef, List<Map<String, Object>> items) {
		if (!available(entityDef) || uiOptions.isHidden(entityDef)) {
			return;
		}
		String entityParameter = parameterName(entityDef);
		if (!entityDef.isMultiple()) {
			Map<String, Object> group = new LinkedHashMap<>();
			group.put("kind", "group");
			group.put("label", label(entityDef));
			putIfNotBlank(group, "description", description(entityDef));
			group.put("fields", childFields(entityDef, entityParameter + "."));
			items.add(group);
			return;
		}
		CodeAttributeDefinition enumerator = entityDef.getEnumeratingKeyCodeAttribute();
		if (enumerator == null) {
			// Only a form of its own (a multiple entity form tab) can add and remove entities
			Map<String, Object> multiple = multipleEntityItem(entityDef);
			if (multiple != null) {
				items.add(multiple);
			}
			return;
		}
		Map<String, Object> table = new LinkedHashMap<>();
		table.put("kind", "table");
		table.put("label", label(entityDef));
		putIfNotBlank(table, "description", description(entityDef));
		List<Map<String, Object>> columns = new ArrayList<>();
		for (NodeDefinition childDef : entityDef.getChildDefinitions()) {
			if (childDef != enumerator && shownChild(childDef)) {
				Map<String, Object> column = new LinkedHashMap<>();
				column.put("label", label(childDef));
				putIfNotBlank(column, "description", description(childDef));
				columns.add(column);
			}
		}
		table.put("columns", columns);
		List<Map<String, Object>> rows = new ArrayList<>();
		for (CodeListItem item : rootItems(enumerator.getList())) {
			Map<String, Object> row = new LinkedHashMap<>();
			row.put("code", item.getCode());
			row.put("label", itemLabel(item));
			putIfNotBlank(row, "description", itemDescription(item));
			List<Map<String, Object>> fields = new ArrayList<>();
			String prefix = entityParameter + "[" + item.getCode() + "].";
			for (NodeDefinition childDef : entityDef.getChildDefinitions()) {
				if (childDef != enumerator && shownChild(childDef)) {
					Map<String, Object> field = field((AttributeDefinition) childDef, prefix + childPrefix(childDef));
					// a column without a control keeps the table aligned
					fields.add(field == null ? unsupportedField(childDef, prefix + childDef.getName()) : field);
				}
			}
			row.put("fields", fields);
			rows.add(row);
		}
		table.put("rows", rows);
		items.add(table);
	}

	/** A multiple entity the operator adds rows to; the field names hold $index, which the form replaces with 1, 2, ... */
	private Map<String, Object> multipleEntityItem(EntityDefinition entityDef) {
		if (entityDef == null || !available(entityDef)) {
			return null;
		}
		Map<String, Object> multiple = new LinkedHashMap<>();
		multiple.put("kind", "multiple");
		multiple.put("entity", entityDef.getName());
		multiple.put("label", label(entityDef));
		putIfNotBlank(multiple, "description", description(entityDef));
		multiple.put("fields", childFields(entityDef, parameterName(entityDef) + "[$index]."));
		return multiple;
	}

	private List<Map<String, Object>> childFields(EntityDefinition entityDef, String prefix) {
		List<Map<String, Object>> fields = new ArrayList<>();
		for (NodeDefinition childDef : entityDef.getChildDefinitions()) {
			if (childDef instanceof EntityDefinition) {
				if (available(childDef)) {
					unsupported(childDef, "nested entity");
				}
			} else if (shownChild(childDef)) {
				Map<String, Object> field = field((AttributeDefinition) childDef, prefix + childPrefix(childDef));
				if (field != null) {
					fields.add(field);
				}
			}
		}
		return fields;
	}

	private boolean shownChild(NodeDefinition def) {
		return def instanceof AttributeDefinition && available(def) && !uiOptions.isHidden(def);
	}

	private Map<String, Object> field(AttributeDefinition def, String name) {
		String type = fieldType(def);
		if (type == null) {
			unsupported(def, "attribute type");
			return null;
		}
		Map<String, Object> field = new LinkedHashMap<>();
		field.put("kind", "field");
		field.put("name", name);
		field.put("type", type);
		field.put("label", label(def));
		putIfNotBlank(field, "description", description(def));
		if (def.isMultiple()) {
			field.put("multiple", true);
		}
		if (def.isCalculated()) {
			field.put("readOnly", true);
			field.put("calculated", true);
		}
		if (def instanceof BooleanAttributeDefinition && ((BooleanAttributeDefinition) def).isAffirmativeOnly()) {
			field.put("affirmativeOnly", true);
		}
		if (def instanceof NumericAttributeDefinition) {
			Unit unit = ((NumericAttributeDefinition) def).getDefaultUnit();
			if (unit != null) {
				putIfNotBlank(field, "unit", StringUtils.defaultIfBlank(unit.getAbbreviation(language, defaultLanguage),
						unit.getLabel(language, defaultLanguage)));
			}
		}
		if (def instanceof CodeAttributeDefinition) {
			field.put("code", codeModel((CodeAttributeDefinition) def, name));
		}
		return field;
	}

	/** The field types the form renders; null for the ones Collect Earth cannot save from a balloon. */
	static String fieldType(AttributeDefinition def) {
		if (def instanceof BooleanAttributeDefinition) return "boolean";
		if (def instanceof CodeAttributeDefinition) return "code";
		if (def instanceof CoordinateAttributeDefinition) return "coordinate";
		if (def instanceof DateAttributeDefinition) return "date";
		if (def instanceof TimeAttributeDefinition) return "time";
		if (def instanceof NumberAttributeDefinition) {
			return ((NumberAttributeDefinition) def).isInteger() ? "integer" : "real";
		}
		if (def instanceof TextAttributeDefinition) {
			return ((TextAttributeDefinition) def).getType() == TextAttributeDefinition.Type.MEMO ? "memo" : "text";
		}
		// Ranges: "integer_range_" parameters are read by the integer handler, so they cannot be saved yet.
		// Taxon and file attributes have no handler at all.
		return null;
	}

	private Map<String, Object> codeModel(CodeAttributeDefinition def, String name) {
		Map<String, Object> code = new LinkedHashMap<>();
		CodeAttributeLayoutType layout = uiOptions.getLayoutType(def);
		code.put("layout", layout == CodeAttributeLayoutType.DROPDOWN ? "dropdown" : "buttons");
		CodeAttributeDefinition parentDef = def.getParentCodeAttributeDefinition();
		if (parentDef != null) {
			code.put("parent", siblingParameterName(name, def, parentDef));
		}
		CodeList list = def.getList();
		List<Map<String, Object>> items = new ArrayList<>();
		if (list.isExternal()) {
			unsupported(def, "external code list");
		} else {
			// Every item of the attribute's level: the form shows the children of the parent's selection
			List<CodeListItem> level = rootItems(list);
			for (int depth = 0; depth < def.getLevelIndex(); depth++) {
				List<CodeListItem> next = new ArrayList<>();
				for (CodeListItem item : level) {
					for (CodeListItem child : item.<CodeListItem>getChildItems()) {
						if (available(child)) {
							next.add(child);
						}
					}
				}
				level = next;
			}
			for (CodeListItem item : level) {
				Map<String, Object> entry = new LinkedHashMap<>();
				entry.put("id", item.getId());
				entry.put("code", item.getCode());
				entry.put("label", itemLabel(item));
				putIfNotBlank(entry, "description", itemDescription(item));
				if (item.getParentItem() != null) {
					entry.put("parentId", item.getParentItem().getId());
				}
				if (item.isQualifiable()) {
					entry.put("qualifiable", true);
				}
				items.add(entry);
			}
		}
		code.put("items", items);
		return code;
	}

	/** The parent code field sits next to its child: in the same entity instance, or at the root. */
	private String siblingParameterName(String name, CodeAttributeDefinition def, CodeAttributeDefinition parentDef) {
		String parentName = parameterName(parentDef);
		if (parentDef.getParentEntityDefinition() == def.getParentEntityDefinition() && !def.getParentEntityDefinition().isRoot()) {
			int dot = name.lastIndexOf('.');
			return name.substring(0, dot + 1) + parentName.substring(COLLECT_PREFIX.length());
		}
		return parentName;
	}

	private List<CodeListItem> rootItems(CodeList list) {
		List<CodeListItem> result = new ArrayList<>();
		if (!list.isExternal()) {
			for (CodeListItem item : list.<CodeListItem>getItems()) {
				if (available(item)) {
					result.add(item);
				}
			}
		}
		return result;
	}

	private boolean handled(AttributeDefinition def) {
		try {
			balloonUtils.getCollectBalloonParamName(def);
			return true;
		} catch (IllegalArgumentException e) {
			return false;
		}
	}

	/** collect_&lt;prefix&gt;&lt;name&gt;, as the balloon names it. */
	private String parameterName(NodeDefinition def) {
		return balloonUtils.getCollectBalloonParamName(def);
	}

	/** &lt;prefix&gt;&lt;name&gt; of an entity child, after "collect_entity_x[...]." */
	private String childPrefix(NodeDefinition def) {
		try {
			return parameterName(def).substring(COLLECT_PREFIX.length());
		} catch (IllegalArgumentException e) {
			return def.getName();
		}
	}

	private Map<String, Object> unsupportedField(NodeDefinition def, String name) {
		Map<String, Object> field = new LinkedHashMap<>();
		field.put("kind", "field");
		field.put("name", name);
		field.put("type", "unsupported");
		field.put("label", label(def));
		return field;
	}

	private void unsupported(NodeDefinition def, String reason) {
		Map<String, Object> entry = new LinkedHashMap<>();
		entry.put("name", def.getName());
		entry.put("reason", reason);
		unsupported.add(entry);
	}

	private boolean available(VersionableSurveyObject object) {
		return version == null || version.isApplicable(object);
	}

	private String label(NodeDefinition def) {
		String label = def.getLabel(Type.INSTANCE, language);
		if (StringUtils.isBlank(label)) label = def.getLabel(Type.INSTANCE, defaultLanguage);
		if (StringUtils.isBlank(label)) label = def.getLabel(Type.INSTANCE);
		return StringUtils.isBlank(label) ? def.getName() : label;
	}

	private String description(NodeDefinition def) {
		String description = def.getDescription(language);
		return StringUtils.isBlank(description) ? def.getDescription(defaultLanguage) : description;
	}

	private String itemLabel(CodeListItem item) {
		String label = item.getLabel(language);
		if (StringUtils.isBlank(label)) label = item.getLabel(defaultLanguage);
		if (StringUtils.isBlank(label)) label = item.getLabel();
		return StringUtils.isBlank(label) ? item.getCode() : label;
	}

	private String itemDescription(CodeListItem item) {
		String description = item.getDescription(language);
		return StringUtils.isBlank(description) ? item.getDescription(defaultLanguage) : description;
	}

	private static void putIfNotBlank(Map<String, Object> map, String key, String value) {
		if (StringUtils.isNotBlank(value)) {
			map.put(key, value.trim());
		}
	}
}

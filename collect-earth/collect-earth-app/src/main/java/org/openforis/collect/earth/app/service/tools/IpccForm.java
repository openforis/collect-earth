package org.openforis.collect.earth.app.service.tools;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.tools.IpccAnswers.Subdivision;
import org.openforis.collect.earth.app.service.tools.ToolsService.InvalidToolRequestException;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.ipcc.RegionColumnEnum;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.CountryCode;
import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandTypeEnum;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.ForestTypeEnum;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.LandUseCategoryEnum;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;
import org.openforis.collect.earth.ipcc.model.PerennialCropTypesEnum;
import org.openforis.collect.earth.ipcc.model.SettlementTypeEnum;
import org.openforis.collect.earth.ipcc.model.VegetationTypeEnum;

/**
 * The form of the LULUCF package, which replaces the Swing AssignSubdivisionTypesWizard: the country and the region
 * attribute of its first page, then, per land use category, the subdivisions found in the data with the management
 * type each page offered (and the forest, perennial crop or vegetation type the forest, cropland and grassland pages
 * added). toJson() is what the page draws; apply() puts the page's answers on the subdivisions, as the wizard's
 * combo boxes did.
 */
public final class IpccForm {

	/** What a category's page offered besides the management type */
	private static final class Extra {
		final String name;
		final String labelKey;
		final Enum<?>[] options;

		Extra(String name, String labelKey, Enum<?>[] options) {
			this.name = name;
			this.labelKey = labelKey;
			this.options = options;
		}
	}

	private final List<AbstractLandUseSubdivision> subdivisions;
	private final List<String> attributes;
	private final CountryCode[] countries;

	public IpccForm(List<AbstractLandUseSubdivision> subdivisions, List<String> attributes, CountryCode[] countries) {
		this.subdivisions = subdivisions;
		this.attributes = attributes;
		this.countries = countries;
	}

	/** The management types a category's page offered (AbstractSubdivisionPage.getValues) */
	static Enum<?>[] managementTypes(LandUseCategoryEnum category) {
		switch (category) {
		case C:
			return CroplandTypeEnum.values();
		case S:
			return SettlementTypeEnum.values();
		default:
			return ManagementTypeEnum.values();
		}
	}

	private static Extra extraOf(LandUseCategoryEnum category) {
		switch (category) {
		case F:
			return new Extra("forestType", "ToolsPage.ipcc.forestType", ForestTypeEnum.values());
		case C:
			return new Extra("perennialCropType", "ToolsPage.ipcc.perennialCropType", PerennialCropTypesEnum.values());
		case G:
			return new Extra("vegetationType", "ToolsPage.ipcc.vegetationType", VegetationTypeEnum.values());
		default:
			return null;
		}
	}

	private static Enum<?> extraOf(AbstractLandUseSubdivision subdivision) {
		if (subdivision instanceof ForestSubdivision) {
			return ((ForestSubdivision) subdivision).getForestType();
		} else if (subdivision instanceof CroplandSubdivision) {
			return ((CroplandSubdivision) subdivision).getPerennialCropType();
		} else if (subdivision instanceof GrasslandSubdivision) {
			return ((GrasslandSubdivision) subdivision).getVegetationType();
		}
		return null;
	}

	/** The attribute the wizard preselected: province, country or district when the survey has one of them. */
	static String defaultAttribute(List<String> attributes) {
		for (RegionColumnEnum column : new RegionColumnEnum[] { RegionColumnEnum.PROVINCE, RegionColumnEnum.COUNTRY, RegionColumnEnum.DISTRICT }) {
			if (attributes.contains(column.getColumnName())) {
				return column.getColumnName();
			}
		}
		return attributes.isEmpty() ? null : attributes.get(0);
	}

	public Map<String, Object> toJson() {
		Map<String, Object> json = new LinkedHashMap<>();
		List<Map<String, String>> countryList = new ArrayList<>();
		for (CountryCode country : countries) {
			Map<String, String> entry = new LinkedHashMap<>();
			entry.put("code", country.getCode());
			entry.put("name", country.getName());
			countryList.add(entry);
		}
		json.put("countries", countryList);
		json.put("attributes", attributes);
		json.put("defaultAttribute", defaultAttribute(attributes));
		List<Map<String, Object>> categories = new ArrayList<>();
		for (LandUseCategoryEnum category : LandUseCategoryEnum.values()) {
			Map<String, Object> entry = new LinkedHashMap<>();
			entry.put("code", category.getCode());
			entry.put("label", Messages.getString("ToolsPage.ipcc.category." + category.getCode()));
			entry.put("managementTypes", options(managementTypes(category)));
			Extra extra = extraOf(category);
			if (extra == null) {
				entry.put("extra", null);
			} else {
				Map<String, Object> extraJson = new LinkedHashMap<>();
				extraJson.put("name", extra.name);
				extraJson.put("label", Messages.getString(extra.labelKey));
				extraJson.put("options", options(extra.options));
				entry.put("extra", extraJson);
			}
			List<Map<String, Object>> rows = new ArrayList<>();
			for (AbstractLandUseSubdivision subdivision : subdivisions) {
				if (subdivision.getCategory() != category) {
					continue;
				}
				Map<String, Object> row = new LinkedHashMap<>();
				row.put("guid", subdivision.getGuid());
				row.put("code", subdivision.getCode());
				row.put("name", subdivision.getName());
				Object management = subdivision.getManagementType();
				row.put("managementType", management instanceof Enum ? ((Enum<?>) management).name() : null);
				Enum<?> extraValue = extraOf(subdivision);
				row.put("type", extraValue == null ? null : extraValue.name());
				rows.add(row);
			}
			entry.put("subdivisions", rows);
			categories.add(entry);
		}
		json.put("categories", categories);
		return json;
	}

	private static List<Map<String, String>> options(Enum<?>[] values) {
		List<Map<String, String>> options = new ArrayList<>();
		for (Enum<?> value : values) {
			Map<String, String> option = new LinkedHashMap<>();
			option.put("value", value.name());
			// The enums print their English name, which the wizard showed
			option.put("label", value.toString());
			options.add(option);
		}
		return options;
	}

	/**
	 * Puts the answers on the subdivisions, as the wizard's combo boxes did, and checks them: every subdivision needs a
	 * management type its category offers; the country must be one of the list and the region attribute one of the
	 * survey's.
	 */
	@SuppressWarnings({ "unchecked", "rawtypes" })
	public void apply(IpccAnswers answers) throws InvalidToolRequestException {
		if (answers == null || StringUtils.isBlank(answers.country) || countryOf(answers.country) == null) {
			throw new InvalidToolRequestException("ipcc.country", Messages.getString("ToolsPage.ipcc.noCountry"));
		}
		if (StringUtils.isBlank(answers.regionAttribute) || !attributes.contains(answers.regionAttribute)) {
			throw new InvalidToolRequestException("ipcc.region", Messages.getString("ToolsPage.ipcc.noRegion"));
		}
		Map<String, Subdivision> byGuid = new LinkedHashMap<>();
		if (answers.subdivisions != null) {
			for (Subdivision answer : answers.subdivisions) {
				byGuid.put(answer.guid, answer);
			}
		}
		for (AbstractLandUseSubdivision subdivision : subdivisions) {
			Subdivision answer = byGuid.get(subdivision.getGuid());
			String management = answer == null ? null : answer.managementType;
			Enum<?> type = constant(managementTypes(subdivision.getCategory()), management);
			if (type == null) {
				throw new InvalidToolRequestException("ipcc.subdivision",
						String.format(Messages.getString("ToolsPage.ipcc.noManagement"), subdivision.getCategory().getCode() + " / " + subdivision.getCode()));
			}
			((AbstractLandUseSubdivision) subdivision).setManagementType(type);
			Extra extra = extraOf(subdivision.getCategory());
			if (extra != null) {
				Enum<?> extraValue = constant(extra.options, answer.type);
				if (subdivision instanceof ForestSubdivision) {
					((ForestSubdivision) subdivision).setForestType((ForestTypeEnum) extraValue);
				} else if (subdivision instanceof CroplandSubdivision) {
					((CroplandSubdivision) subdivision).setPerennialCropType(extraValue == null ? PerennialCropTypesEnum.ALL : (PerennialCropTypesEnum) extraValue);
				} else if (subdivision instanceof GrasslandSubdivision) {
					((GrasslandSubdivision) subdivision).setVegetationType((VegetationTypeEnum) extraValue);
				}
			}
		}
	}

	public CountryCode countryOf(String code) {
		for (CountryCode country : countries) {
			if (country.getCode().equals(code)) {
				return country;
			}
		}
		return null;
	}

	private static Enum<?> constant(Enum<?>[] values, String name) {
		if (name == null) {
			return null;
		}
		return Arrays.stream(values).filter(v -> v.name().equals(name)).findFirst().orElse(null);
	}
}

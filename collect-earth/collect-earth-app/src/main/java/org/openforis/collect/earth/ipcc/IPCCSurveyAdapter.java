package org.openforis.collect.earth.ipcc;

import java.util.ArrayList;

import javax.xml.namespace.QName;

import org.openforis.idm.metamodel.AttributeDefault;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeLabel;
import org.openforis.idm.metamodel.Survey;
import org.openforis.idm.metamodel.TextAttributeDefinition;
import org.openforis.idm.path.InvalidPathException;

public class IPCCSurveyAdapter {

	public static final String IPCC_ATTR_PARENT_SUFIX = "_parent";
	public static final String IPCC_ATTR_PREFIX = "ipcc_";
	public static final String IPCC_CATEGORY = "_category";
	public static final String IPCC_SUBCATEGORY = "_subcategory";
	public static final String IPCC_SUBDIVISION = "_subdivision";

	public static final String ATTR_CURRENT_CATEGORY = IPCC_ATTR_PREFIX + "current_category";
	public static final String ATTR_CURRENT_SUBDIVISION = IPCC_ATTR_PREFIX + "current_subdivision";
	public static final String ATTR_OLDEST_CATEGORY = IPCC_ATTR_PREFIX + "oldest_category";
	public static final String ATTR_PREVIOUS_CATEGORY = IPCC_ATTR_PREFIX + "previous_category";
	public static final String ATTR_PREVIOUS_SUBDIVISION = IPCC_ATTR_PREFIX + "previous_subdivision";
	private static final String CODE_LIST_LAND_USE = "land_uses";
	private static final String CODE_LIST_LAND_USE_SUBCATEGORY = "land_use_conversions";

	private static final int IPCC_20_YEARS_RULE = 20;


	private static final String PLOT_ENTITY = "plot";

	private static final String TEMPLATE_LAND_USE_CATEGORY = "land_use_category";
	private static final String TEMPLATE_LAND_USE_CATEGORY_CHANGED = "land_use_category_has_changed";
	private static final String TEMPLATE_LAND_USE_CHANGE_ONCE = "land_use_change_once";
	private static final String TEMPLATE_LAND_USE_INITIAL_SUBDIVISION = "land_use_initial_subdivision";
	private static final String TEMPLATE_LAND_USE_PREVIOUS_SUBDIVISION = "land_use_initial_subdivision";
	private static final String TEMPLATE_LAND_USE_SECOND_SUBDIVISION = "second_lu_subdivision";
	private static final String TEMPLATE_LAND_USE_SUBCATEGORY = "land_use_subcategory";
	private static final String TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED = "land_use_subcategory_year_of_change";
	private static final String TEMPLATE_LAND_USE_SUBDIVISION = "land_use_subdivision";
	private static final String TEMPLATE_LAND_USE_SUBDIVISION_CHANGED = "land_use_subdivision_change";
	private static final String TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED = "land_use_subdivision_year_of_change";
	private static final String TEMPLATE_SECOND_LU_CHANGE = "second_lu_change";
	private static final String TEMPLATE_SECOND_LU_CONVERSION = "second_lu_conversion";
	private static final String TEMPLATE_SECOND_LU_CONVERSION_YEAR = "second_lu_conversion_year";
	
	public static String getIpccCategoryAttrName(int year) {
		return IPCC_ATTR_PREFIX + year + IPCC_CATEGORY;
	}

	public static String getIpccSubdivisionAttrName(int year) {
		return IPCC_ATTR_PREFIX + year + IPCC_SUBDIVISION;
	}
	
	private boolean attributeAlreadyExists( EntityDefinition plot, String attributeName ) {
		
		return plot.containsChildDefinition( attributeName );
		
	}

	private void addAuxilliaryAttributes(Survey survey, EntityDefinition plot) {
		// Adds a Current Category LU 2022 calculated attribute to be used for the
		// Subdivision as parent
		CodeAttributeDefinition currentLu;
		if(!attributeAlreadyExists(plot, ATTR_CURRENT_CATEGORY ) ) {
			currentLu = survey.getSchema().createCodeAttributeDefinition();
			currentLu.setName(ATTR_CURRENT_CATEGORY);
			currentLu.setListName( CODE_LIST_LAND_USE );
			currentLu.setCalculated(true);
			currentLu.setLabel(NodeLabel.Type.INSTANCE, "en", "IPCC Land Use Category - current");
			currentLu.setLabel(NodeLabel.Type.INSTANCE, "es", "IPCC Categoría Uso de la Tierra - Actual");
			currentLu.setLabel(NodeLabel.Type.INSTANCE, "fr", "GIEC Catégorie d'utilisation des terres - actuelle");
			AttributeDefault attributeDefault = new AttributeDefault();
			attributeDefault.setExpression("substring( " + TEMPLATE_LAND_USE_SUBCATEGORY + ", 2, 1)"); // get the second
																										// character of the
																										// LU conversion CF
																										// --> F
			ArrayList<AttributeDefault> calculation = new ArrayList<AttributeDefault>();
			calculation.add(attributeDefault);
			currentLu.setAttributeDefaults(calculation);
			currentLu.setAnnotation( new QName("ui:hide"), "true" );
			plot.addChildDefinition(currentLu);
		}else {
			currentLu = (CodeAttributeDefinition) plot.getChildDefinition(ATTR_CURRENT_CATEGORY);
		}

		if(!attributeAlreadyExists(plot, ATTR_CURRENT_SUBDIVISION ) ) {
			// adds the Current Subdivision 2022 attribute, which is just a copy of
			// land_use_subdivision
			CodeAttributeDefinition currentLuSubdivision = survey.getSchema().createCodeAttributeDefinition();
			currentLuSubdivision.setName(ATTR_CURRENT_SUBDIVISION);
			currentLuSubdivision.setListName(CODE_LIST_LAND_USE);
			currentLuSubdivision.setParentCodeAttributeDefinition(currentLu);
			currentLuSubdivision.setLabel(NodeLabel.Type.INSTANCE, "en", "IPCC Land Use Subdivision - current");
			currentLuSubdivision.setLabel(NodeLabel.Type.INSTANCE, "es", "IPCC Subdivisión Uso de la Tierra - actual");
			currentLuSubdivision.setLabel(NodeLabel.Type.INSTANCE, "fr", "GIEC Subdivision d'utilisation des terres - actuelle");
			AttributeDefault attributeDefault = new AttributeDefault();
			attributeDefault.setExpression(TEMPLATE_LAND_USE_SUBDIVISION); // gets the current LU subdivision
			ArrayList<AttributeDefault> calculation = new ArrayList<AttributeDefault>();
			calculation.add(attributeDefault);
			currentLuSubdivision.setAttributeDefaults(calculation);
			currentLuSubdivision.setAnnotation( new QName("ui:hide"), "true" );
			plot.addChildDefinition(currentLuSubdivision);
		}
		
		if(!attributeAlreadyExists(plot, ATTR_PREVIOUS_CATEGORY ) ) {
			// Adds a Previous Category LU using the LU Conversion attribute
			CodeAttributeDefinition previousLu = survey.getSchema().createCodeAttributeDefinition();
			previousLu.setName(ATTR_PREVIOUS_CATEGORY);
			previousLu.setListName(CODE_LIST_LAND_USE);
			previousLu.setCalculated(true);
			previousLu.setLabel(NodeLabel.Type.INSTANCE, "en", "IPCC Land Use Category - previous");
			previousLu.setLabel(NodeLabel.Type.INSTANCE, "es", "IPCC Categoría Uso de la Tierra - Previa");
			previousLu.setLabel(NodeLabel.Type.INSTANCE, "fr", "GIEC Catégorie d'utilisation des terres - précédent");
			AttributeDefault attributeDefault = new AttributeDefault();
			attributeDefault.setExpression("substring( " + TEMPLATE_LAND_USE_SUBCATEGORY + ", 1, 1)"); // get the first
																										// character of the
																										// LU conversion CF
																										// --> C
			ArrayList<AttributeDefault> calculation = new ArrayList<AttributeDefault>();
			calculation.add(attributeDefault);
			previousLu.setAttributeDefaults(calculation);
			previousLu.setAnnotation( new QName("ui:hide"), "true" );
			plot.addChildDefinition(previousLu);
		}
		
		if(!attributeAlreadyExists(plot, ATTR_OLDEST_CATEGORY ) ) {
			// Adds a Previous Category LU using the LU Conversion attribute
			CodeAttributeDefinition oldestLu = survey.getSchema().createCodeAttributeDefinition();
			oldestLu.setName(ATTR_OLDEST_CATEGORY);
			oldestLu.setListName(CODE_LIST_LAND_USE);
			oldestLu.setCalculated(true);
			oldestLu.setLabel(NodeLabel.Type.INSTANCE, "en", "IPCC Land Use Category - oldest");
			oldestLu.setLabel(NodeLabel.Type.INSTANCE, "es", "IPCC Categoría Uso de la Tierra - Mas antigua");
			oldestLu.setLabel(NodeLabel.Type.INSTANCE, "fr", "GIEC Catégorie d'utilisation des terres - plus ancien");
			ArrayList<AttributeDefault> calculation = new ArrayList<AttributeDefault>();
			calculation.add(new AttributeDefault("substring( " + TEMPLATE_SECOND_LU_CONVERSION + ", 1,1)", // if the oldest
																											// LU conversion
																											// was FS then
																											// it becomes F
					TEMPLATE_SECOND_LU_CHANGE + " = true() "));
			calculation.add(new AttributeDefault("substring( " + TEMPLATE_LAND_USE_SUBCATEGORY + ", 1,1)", // if the oldest
																											// LU conversion
																											// was FS then
																											// it becomes F
					"idm:blank(" + TEMPLATE_SECOND_LU_CHANGE + ") or " + TEMPLATE_SECOND_LU_CHANGE + " = true() "));
	
			oldestLu.setAttributeDefaults(calculation);
			oldestLu.setAnnotation( new QName("ui:hide"), "true" );
			plot.addChildDefinition(oldestLu);
		}
	}

	private String getCodeListName(Survey survey, String[] codeListLandUse) {
		for (String codeListName : codeListLandUse) {
			if( survey.getCodeList(codeListName) != null ) {
				return codeListName;
			}
		}
		throw new IllegalArgumentException( "No codelist with names is available " + codeListLandUse );
	}

	private Survey addIPCCAttributes(Survey survey) {
		EntityDefinition plot = survey.getSchema().getRootEntityDefinition("plot");
		addAuxilliaryAttributes(survey, plot);

		for (int year = IPCCGenerator.START_YEAR; year <= IPCCGenerator.END_YEAR; year++) {
			addLuSubcategory(survey, plot, year);
			CodeAttributeDefinition category = addLuCategory(survey, plot, year);
			addLuSubdivision(survey, plot, category, year);
		}

		return survey;
	}

	public Survey addIPCCAttributesToSurvey(Survey survey) throws IPCCGeneratorException {
		// Check if the Survey follows the latest 2022 IPCC Survey Template
		// If the survey is based on the latest IPCC 2022 Template no further processing
		// is needed
		if (!is2022IPCCTemplate(survey)) {
			// Check that survey has necessary attributes and code-lists
			checkSurveyLUAttributes(survey);
			checkSurveyLUCodeLists(survey);

			// All the necessary attributes are present
			// Add the yearly LAND USE cat/subcategory/subdivision attributes!
			return addIPCCAttributes(survey);

		} else {
			return survey;
		}
	}

	private CodeAttributeDefinition addLuCategory(Survey survey, EntityDefinition plot, int year) {
		if(!attributeAlreadyExists(plot, getIpccCategoryAttrName(year) ) ) {
			// Create the parent attribute for the LU Subcategory ( the initial Land Use)
			CodeAttributeDefinition category = survey.getSchema().createCodeAttributeDefinition();
			category.setName(getIpccCategoryAttrName(year));
			category.setLabel(NodeLabel.Type.INSTANCE, "en", "IPCC " + year + " Land Use Category");
			category.setLabel(NodeLabel.Type.INSTANCE, "es", "IPCC " + year + " Categoría Uso de la Tierra");
			category.setLabel(NodeLabel.Type.INSTANCE, "fr", "GIEC " + year + " Catégorie d'utilisation des terres ");
			category.setListName(CODE_LIST_LAND_USE);
			category.setCalculated(true);
	
			ArrayList<AttributeDefault> calculation = new ArrayList<AttributeDefault>();
			calculation.add(new AttributeDefault("substring(" + (IPCC_ATTR_PREFIX + year + IPCC_SUBCATEGORY) + ", 2, 1)"));
	
			category.setAttributeDefaults(calculation);
			category.setAnnotation( new QName("ui:hide"), "true" );
			plot.addChildDefinition(category);
			return category;
		} else {
			return  (CodeAttributeDefinition) plot.getChildDefinition(getIpccCategoryAttrName(year));
		}
	}

	private void addLuSubcategory(Survey survey, EntityDefinition plot, int year) {
		if(!attributeAlreadyExists(plot, IPCC_ATTR_PREFIX + year + IPCC_SUBCATEGORY ) ) {
			// Create the parent attribute for the LU Subcategory ( the initial Land Use)
			TextAttributeDefinition subcategory = survey.getSchema().createTextAttributeDefinition();
			subcategory.setName(IPCC_ATTR_PREFIX + year + IPCC_SUBCATEGORY);
			subcategory.setLabel(NodeLabel.Type.INSTANCE, "en", "IPCC " + year + " Land Use Conversion");
			subcategory.setLabel(NodeLabel.Type.INSTANCE, "es", "IPCC " + year + " Conversión de Uso de la Tierra");
			subcategory.setLabel(NodeLabel.Type.INSTANCE, "fr", "GIEC " + year + " Conversion de l'utilisation des terres");
			subcategory.setCalculated(true);
	
			int thresHold20Years = year - IPCC_20_YEARS_RULE;
	
			ArrayList<AttributeDefault> calculation = new ArrayList<AttributeDefault>();
	
			calculation.add(
					new AttributeDefault(
						TEMPLATE_LAND_USE_SUBCATEGORY, 
						TEMPLATE_LAND_USE_CATEGORY_CHANGED + "!= true()" +
						" and ( idm:blank(" + TEMPLATE_SECOND_LU_CHANGE + " ) or " + TEMPLATE_SECOND_LU_CHANGE + " != true() ) "
						)
					);
	
			calculation.add(new AttributeDefault(
						TEMPLATE_LAND_USE_SUBCATEGORY,
						TEMPLATE_LAND_USE_CATEGORY_CHANGED + 
						" and " + TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + " <= "	+ year + 
						" and " + TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + "  >=" + thresHold20Years)
					);
	
			calculation.add(new AttributeDefault(
						"concat(" + ATTR_CURRENT_CATEGORY + "," + ATTR_CURRENT_CATEGORY + ")",
						TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + " < " + thresHold20Years)
					);
	
			calculation.add(new AttributeDefault(
					"concat(" + ATTR_PREVIOUS_CATEGORY + "," + ATTR_PREVIOUS_CATEGORY + ")",
						TEMPLATE_LAND_USE_CATEGORY_CHANGED + 
						" and ( idm:blank(" + TEMPLATE_SECOND_LU_CHANGE + " ) or " + TEMPLATE_SECOND_LU_CHANGE + " != true() ) " +  
						"and " + TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + " > " + year)
					);
	
			calculation.add(new AttributeDefault(
						"concat(" + ATTR_OLDEST_CATEGORY + "," + ATTR_PREVIOUS_CATEGORY + ")",
						TEMPLATE_SECOND_LU_CHANGE + "=true() " + 
						"and " + TEMPLATE_SECOND_LU_CONVERSION_YEAR + " <= " + year	+ 
						" and " + TEMPLATE_SECOND_LU_CONVERSION_YEAR + " >= " + thresHold20Years)
					);
	
			calculation.add(new AttributeDefault(
						"concat(" + ATTR_PREVIOUS_CATEGORY + "," + ATTR_PREVIOUS_CATEGORY + ")",
						TEMPLATE_SECOND_LU_CHANGE + "=true() " + 
						" and " + TEMPLATE_SECOND_LU_CONVERSION_YEAR + " < " + thresHold20Years)
					);
	
			calculation.add(new AttributeDefault(
						"concat(" + ATTR_OLDEST_CATEGORY + "," + ATTR_OLDEST_CATEGORY + ")",
						TEMPLATE_SECOND_LU_CHANGE + "=true() " + 
						"and " + TEMPLATE_SECOND_LU_CONVERSION_YEAR + " >= "+ thresHold20Years)
					);
	
			subcategory.setAttributeDefaults(calculation);
			subcategory.setAnnotation( new QName("ui:hide"), "true" );
			plot.addChildDefinition(subcategory);
		}
	}

	private void addLuSubdivision(Survey survey, EntityDefinition plot, CodeAttributeDefinition categoryParent,
			int year) {
		if(!attributeAlreadyExists(plot, getIpccSubdivisionAttrName(year) ) ) {
			CodeAttributeDefinition subdivision = survey.getSchema().createCodeAttributeDefinition();
			subdivision.setName(getIpccSubdivisionAttrName(year));
			subdivision.setLabel(NodeLabel.Type.INSTANCE, "en", "IPCC " + year + " Land Use Subdivision");
			subdivision.setLabel(NodeLabel.Type.INSTANCE, "es", "IPCC " + year + " Subdivisión de Uso de la Tierra");
			subdivision.setLabel(NodeLabel.Type.INSTANCE, "fr", "GIEC " + year + " Subdivision d'utilisation des terres");
			subdivision.setListName(CODE_LIST_LAND_USE);
			subdivision.setParentCodeAttributeDefinition(categoryParent);
			subdivision.setCalculated(true);
	
			ArrayList<AttributeDefault> calculation = new ArrayList<AttributeDefault>();
	
			calculation
					.add(new AttributeDefault(
							TEMPLATE_LAND_USE_SUBDIVISION, 
							TEMPLATE_LAND_USE_CHANGE_ONCE + "!= true()")
					);
	
			calculation
					.add(new AttributeDefault(
							TEMPLATE_LAND_USE_SUBDIVISION, 
							TEMPLATE_LAND_USE_CATEGORY_CHANGED + 
							" and ( idm:blank(" + TEMPLATE_LAND_USE_SUBDIVISION_CHANGED + " ) or " + TEMPLATE_LAND_USE_SUBDIVISION_CHANGED + " != true() ) " +
							" and "	+ TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + " <= " + year)
						);
	
			calculation.add(new AttributeDefault(
					TEMPLATE_LAND_USE_PREVIOUS_SUBDIVISION,
					TEMPLATE_SECOND_LU_CHANGE + " = true()" + 
					" and ( idm:blank(" + TEMPLATE_LAND_USE_CATEGORY_CHANGED + " ) or " + TEMPLATE_LAND_USE_CATEGORY_CHANGED + " != true() ) "+
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_CHANGED	+ "=true() " + 
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED + " > " + year +
					" and "	+ TEMPLATE_SECOND_LU_CONVERSION_YEAR + " <= " + year
			));
	
			calculation.add(new AttributeDefault(
					TEMPLATE_LAND_USE_SUBDIVISION,
					TEMPLATE_SECOND_LU_CHANGE + " = true()" + 
					" and ( idm:blank(" + TEMPLATE_LAND_USE_CATEGORY_CHANGED + " ) or " + TEMPLATE_LAND_USE_CATEGORY_CHANGED + " != true() ) "+
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_CHANGED	+ "=true() " + 
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED + " <= " + year
			));
			
			calculation.add(new AttributeDefault(
					TEMPLATE_LAND_USE_PREVIOUS_SUBDIVISION,
					TEMPLATE_LAND_USE_CATEGORY_CHANGED + " = true() " + 
					" and ( idm:blank(" + TEMPLATE_SECOND_LU_CHANGE + " ) or " + TEMPLATE_SECOND_LU_CHANGE + " != true() ) " + 
					"and " + TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED	+ " > " + year)
				);
	
			calculation.add(new AttributeDefault(
					TEMPLATE_LAND_USE_PREVIOUS_SUBDIVISION,
					TEMPLATE_SECOND_LU_CHANGE + "=true() " + 
					"and " + TEMPLATE_SECOND_LU_CONVERSION_YEAR + " <= " + year)
			);
	
			calculation.add(new AttributeDefault(
					TEMPLATE_LAND_USE_SECOND_SUBDIVISION,
					TEMPLATE_SECOND_LU_CHANGE + "=true() " + 
					"and " + TEMPLATE_SECOND_LU_CONVERSION_YEAR + " > " + year)
			);
	
			calculation.add(new AttributeDefault(
					TEMPLATE_LAND_USE_PREVIOUS_SUBDIVISION,
					"( idm:blank(" + TEMPLATE_SECOND_LU_CHANGE + " ) or " + TEMPLATE_SECOND_LU_CHANGE + " != true() ) " + 
					" and  " + TEMPLATE_LAND_USE_CATEGORY_CHANGED + "=true() "+
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_CHANGED	+ "=true() " + 
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED + " > " + year + 
					" and "	+ TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + " <= " + year
	
			));
	
			calculation.add(new AttributeDefault(
					TEMPLATE_LAND_USE_SUBDIVISION,
					"( idm:blank(" + TEMPLATE_SECOND_LU_CHANGE + " ) or " + TEMPLATE_SECOND_LU_CHANGE + " != true() ) "+
					" and  " + TEMPLATE_LAND_USE_CATEGORY_CHANGED + "=true() " + 
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_CHANGED	+ "=true() "+
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED + " <= " + year)
			);
	
			calculation.add(new AttributeDefault(
					TEMPLATE_LAND_USE_PREVIOUS_SUBDIVISION,
					TEMPLATE_LAND_USE_CATEGORY_CHANGED + "=false()  " + 
					"and " + TEMPLATE_LAND_USE_SUBDIVISION_CHANGED	+ "=true() " + 
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED + " > " + year
	
			));
	
			calculation.add(new AttributeDefault(
					TEMPLATE_LAND_USE_SUBDIVISION,
					TEMPLATE_LAND_USE_CATEGORY_CHANGED + "=false() "+
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_CHANGED	+ "=true() " + 
					" and " + TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED + " <= " + year)
			);
	
			subdivision.setAttributeDefaults(calculation);
			subdivision.setAnnotation( new QName("ui:hide"), "true" );
			plot.addChildDefinition(subdivision);
		}
	}

	private void checkSurveyLUAttributes(Survey survey) throws IPCCGeneratorException {
		// Check that the LU attributes are already on the survey
		// If one of them is not available an exception is thrown!
		ArrayList<String> luDefaultAttributePaths = new ArrayList<String>();
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_LAND_USE_CATEGORY);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_LAND_USE_SUBCATEGORY);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_LAND_USE_SUBDIVISION);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_LAND_USE_INITIAL_SUBDIVISION);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_SECOND_LU_CONVERSION);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_SECOND_LU_CONVERSION_YEAR);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_SECOND_LU_CHANGE);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_LAND_USE_SECOND_SUBDIVISION);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_LAND_USE_CATEGORY_CHANGED);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_LAND_USE_SUBDIVISION_CHANGED);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_LAND_USE_CHANGE_ONCE);
		luDefaultAttributePaths.add("/" + PLOT_ENTITY + "/" + TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED);

		for (String attributePath : luDefaultAttributePaths) {
			try {
				survey.getSchema().getDefinitionByPath(attributePath);
			} catch (InvalidPathException e) {
				throw new IPCCGeneratorException("Missing attribute in Survey : " + attributePath, e);
			}
		}

	}

	private void checkSurveyLUCodeLists(Survey survey) throws IPCCGeneratorException {

		ArrayList<String> luCodeLists = new ArrayList<String>();
		luCodeLists.add(CODE_LIST_LAND_USE);
		luCodeLists.add(CODE_LIST_LAND_USE_SUBCATEGORY);

		for (String codeList : luCodeLists) {
			try {
				survey.getCodeList(codeList);
			} catch (InvalidPathException e) {
				throw new IPCCGeneratorException("Missing Code List in Survey : " + codeList, e);
			}
		}
	}

	private boolean is2022IPCCTemplate(Survey survey) {
		// TODO Auto-generated method stub
		// Check if the survey is based on the very latest 2022 IPCC survey template
		// with all the LU changes
		return false;
	}	

}

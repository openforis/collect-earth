package org.openforis.collect.earth.ipcc;

import java.util.ArrayList;
import java.util.Calendar;

import org.openforis.idm.metamodel.AttributeDefault;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeLabel;
import org.openforis.idm.metamodel.Survey;
import org.openforis.idm.metamodel.TextAttributeDefinition;
import org.openforis.idm.path.InvalidPathException;

public class IPCCSurveyAdapter {

	private static final String CODE_LIST_LAND_USE = "land_use";
	private static final String CODE_LIST_LAND_USE_SUBCATEGORY = "land_use_subcategory";
	public static final int START_YEAR = 2000;  // Assume start year at 2000
	public static final int END_YEAR = Calendar.getInstance().get(Calendar.YEAR); // Assume the last year is current year

	public static final String IPCC_ATTR_PREFIX = "ipcc_";
	public static final String IPCC_ATTR_PARENT_SUFIX = "_parent";
	public static final String IPCC_SUBDIVISION = "_subdivision";
	public static final String IPCC_SUBCATEGORY = "_subcategory";
	public static final String IPCC_CATEGORY = "_category";



	private static final int IPCC_20_YEARS_RULE = 20 ;

	public static final String ATTR_CURRENT_CATEGORY = IPCC_ATTR_PREFIX + "current_category";
	public static final String ATTR_CURRENT_SUBDIVISION = IPCC_ATTR_PREFIX + "current_subdivision";
	public static final String ATTR_PREVIOUS_CATEGORY = IPCC_ATTR_PREFIX + "previous_category";
	public static final String ATTR_OLDEST_CATEGORY = IPCC_ATTR_PREFIX + "oldest_category";
	public static final String ATTR_PREVIOUS_SUBDIVISION = IPCC_ATTR_PREFIX + "previous_subdivision";

	private static final String PLOT_ENTITY = "plot";

	private static final String TEMPLATE_LAND_USE_CATEGORY = "land_use_category";
	private static final String TEMPLATE_LAND_USE_SUBCATEGORY = "land_use_subcategory";
	private static final String TEMPLATE_LAND_USE_SUBDIVISION = "land_use_subdivision";
	private static final String TEMPLATE_LAND_USE_INITIAL_SUBDIVISION = "land_use_initial_subdivision";
	private static final String TEMPLATE_LAND_USE_CATEGORY_CHANGED = "land_use_category_has_changed";
	private static final String TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED = "land_use_subcategory_year_of_change";
	private static final String TEMPLATE_SECOND_LU_CONVERSION = "second_lu_conversion";
	private static final String TEMPLATE_SECOND_LU_CHANGE = "second_lu_change";
	private static final String TEMPLATE_SECOND_LU_CONVERSION_YEAR = "second_lu_conversion_year";

	public Survey addIPCCAttributesToSurvey(Survey survey) throws IPCCGeneratorException{

		// Check if the Survey follows the latest 2022 IPCC Survey Template
		// If the survey is based on the latest IPCC 2022 Template no further processing is needed
		if( !is2022IPCCTemplate( survey ) ) {
			// Check that survey has necessary attributes and code-lists
			checkSurveyLUAttributes(survey);
			checkSurveyLUCodeLists(survey);

			// All the necessary attributes are present
			// Add the yearly LAND USE cat/subcategory/subdivision attributes!
			return addIPCCAttributes( survey );

		}else {				
			return survey;
		}
	}

	private Survey addIPCCAttributes(Survey survey) {

		EntityDefinition plot = survey.getSchema().getRootEntityDefinition( "plot");
		addAuxilliaryAttributes( survey, plot );

		for( int year = START_YEAR; year <= END_YEAR; year++ ) {

			addLuSubcategory( survey, plot, year );
			addLuCategory( survey, plot, year );
			addLuSubdivision( survey, plot, year );

		}		

		return survey;
	}

	private void addAuxilliaryAttributes(Survey survey, EntityDefinition plot) {
		
		// Adds a Current Category LU 2022 calculated attribute to be used for the Subdivision as parent
		CodeAttributeDefinition currentLu = survey.getSchema().createCodeAttributeDefinition();
		currentLu.setName( ATTR_CURRENT_CATEGORY );
		currentLu.setListName(CODE_LIST_LAND_USE );
		currentLu.setCalculated( true );
		currentLu.setLabel( NodeLabel.Type.HEADING, "en", "IPCC Land Use Category - current" );
		AttributeDefault attributeDefault = new AttributeDefault();
		attributeDefault.setExpression( "substring( " + TEMPLATE_LAND_USE_SUBCATEGORY +", 2, 1)" ); // get the second character of the LU conversion CF --> F
		ArrayList<AttributeDefault> calculation = new ArrayList<AttributeDefault>();
		calculation.add(attributeDefault);
		currentLu.setAttributeDefaults( calculation );
		plot.addChildDefinition(currentLu);

		// adds the Current Subdivision 2022 attribute, which is just a copy of land_use_subdivision
		CodeAttributeDefinition currentLuSubdivision = survey.getSchema().createCodeAttributeDefinition();
		currentLuSubdivision.setName( ATTR_CURRENT_SUBDIVISION);
		currentLuSubdivision.setListName(CODE_LIST_LAND_USE );
		currentLuSubdivision.setParentCodeAttributeDefinition(currentLu);
		currentLuSubdivision.setLabel( NodeLabel.Type.HEADING, "en", "IPCC Land Use Subdivision - current" );
		attributeDefault = new AttributeDefault();
		attributeDefault.setExpression( TEMPLATE_LAND_USE_SUBDIVISION ); // gets the current LU subdivision
		calculation = new ArrayList<AttributeDefault>();
		calculation.add(attributeDefault);
		currentLuSubdivision.setAttributeDefaults( calculation );
		plot.addChildDefinition(currentLuSubdivision);

		// Adds a Previous Category LU using the LU Conversion attribute
		CodeAttributeDefinition previousLu = survey.getSchema().createCodeAttributeDefinition();
		previousLu.setName( ATTR_PREVIOUS_CATEGORY );
		previousLu.setListName(CODE_LIST_LAND_USE );
		previousLu.setCalculated( true );
		previousLu.setLabel( NodeLabel.Type.HEADING, "en", "IPCC Land Use Category - previous" );
		attributeDefault = new AttributeDefault();
		attributeDefault.setExpression( "substring( " + TEMPLATE_LAND_USE_SUBCATEGORY +", 1, 1)" ); // get the first character of the LU conversion CF --> C
		calculation = new ArrayList<AttributeDefault>();
		calculation.add(attributeDefault);
		previousLu.setAttributeDefaults( calculation );
		plot.addChildDefinition(previousLu);

		// Adds a Previous Category LU using the LU Conversion attribute
		CodeAttributeDefinition oldestLu = survey.getSchema().createCodeAttributeDefinition();
		oldestLu.setName( ATTR_OLDEST_CATEGORY );
		oldestLu.setListName(CODE_LIST_LAND_USE );
		oldestLu.setCalculated( true );
		oldestLu.setLabel( NodeLabel.Type.HEADING, "en", "IPCC Land Use Category - oldest" );
		calculation = new ArrayList<AttributeDefault>();
		calculation.add( 
				new AttributeDefault(
						"substring( " + TEMPLATE_SECOND_LU_CONVERSION + ", 1,1)", // if the oldest LU conversion was FS then it becomes F
						TEMPLATE_SECOND_LU_CHANGE+" = true() "
						)
				);
		calculation.add( 
				new AttributeDefault(
						"substring( " + TEMPLATE_LAND_USE_SUBCATEGORY + ", 1,1)", // if the oldest LU conversion was FS then it becomes F
						"idm:blank(" + TEMPLATE_SECOND_LU_CHANGE + ") or " + TEMPLATE_SECOND_LU_CHANGE + " = true() "
						)
				);

		oldestLu.setAttributeDefaults( calculation );
		plot.addChildDefinition(oldestLu);

	}

	private void addLuSubdivision(Survey survey, EntityDefinition plot, int year) {
		// TODO Auto-generated method stub

	}

	private void addLuCategory(Survey survey, EntityDefinition plot, int year) {
		// TODO Auto-generated method stub

	}

	private void addLuSubcategory(Survey survey, EntityDefinition plot, int year) {

		// Create the parent attribute for the LU Subcategory ( the initial Land Use)

		TextAttributeDefinition subcategory = survey.getSchema().createTextAttributeDefinition();
		subcategory.setName(IPCC_ATTR_PREFIX + year + IPCC_SUBCATEGORY );
		subcategory.setLabel( NodeLabel.Type.HEADING, "en", "IPCC " + year + " Land Use Conversion " );


		ArrayList<AttributeDefault> calculation = new ArrayList<AttributeDefault>();
		calculation.add(new AttributeDefault( 
				TEMPLATE_LAND_USE_SUBCATEGORY, 
				TEMPLATE_LAND_USE_CATEGORY_CHANGED + " and " + TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + " <= "+ year +" and " + TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + "  >=" + (year - IPCC_20_YEARS_RULE )
				)
				);

		calculation.add(
				new AttributeDefault(
						"concat(" + ATTR_CURRENT_CATEGORY + "," + ATTR_CURRENT_CATEGORY + ")", 
						TEMPLATE_LAND_USE_CATEGORY_CHANGED + " and ( idm:blank(" + TEMPLATE_SECOND_LU_CHANGE + " ) or " + TEMPLATE_SECOND_LU_CHANGE + " != true() ) and " +TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + " < " + (year - IPCC_20_YEARS_RULE )
						)
				);

		calculation.add(
				new AttributeDefault(
						"concat(" + ATTR_PREVIOUS_CATEGORY + "," + ATTR_PREVIOUS_CATEGORY + ")", 
						TEMPLATE_LAND_USE_CATEGORY_CHANGED + " and ( idm:blank(" + TEMPLATE_SECOND_LU_CHANGE + " ) or " + TEMPLATE_SECOND_LU_CHANGE + " != true() ) and " +TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + " > " + year
						)
				);

		calculation.add(
				new AttributeDefault(
						"concat(" + ATTR_CURRENT_CATEGORY + "," + ATTR_CURRENT_CATEGORY + ")", 
						TEMPLATE_LAND_USE_CATEGORY_CHANGED + " and " +TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + " < " + (year - IPCC_20_YEARS_RULE )
						)
				);

		calculation.add(
				new AttributeDefault(
						"concat(" + ATTR_OLDEST_CATEGORY + "," + ATTR_PREVIOUS_CATEGORY + ")", 
						TEMPLATE_SECOND_LU_CHANGE + "=true() and " + TEMPLATE_SECOND_LU_CONVERSION_YEAR +" <= " + year + " and " + TEMPLATE_SECOND_LU_CONVERSION_YEAR + " >= " +  (year - IPCC_20_YEARS_RULE )
						)
				);
		
		calculation.add(
				new AttributeDefault(
						"concat(" + ATTR_PREVIOUS_CATEGORY + "," + ATTR_PREVIOUS_CATEGORY + ")", 
						TEMPLATE_SECOND_LU_CHANGE + "=true() and " + TEMPLATE_SECOND_LU_CONVERSION_YEAR + " <= " + ( year - IPCC_20_YEARS_RULE )
					)
				);

		subcategory.setAttributeDefaults( calculation );
		plot.addChildDefinition(subcategory);
	}

	private boolean is2022IPCCTemplate(Survey survey) {
		// TODO Auto-generated method stub
		// Check if the survey is based on the very latest 2022 IPCC survey template with all the LU changes
		return false;
	}

	private void checkSurveyLUAttributes(Survey survey) throws IPCCGeneratorException{
		// Check that the LU attributes are already on the survey
		// If one of them is not available an exception is thrown!
		ArrayList<String> luDefaultAttributePaths = new ArrayList<String>();
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/" + TEMPLATE_LAND_USE_CATEGORY );
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/" + TEMPLATE_LAND_USE_SUBCATEGORY );
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/land_use_subcategory_year_of_change" );
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/" + TEMPLATE_LAND_USE_SUBDIVISION );
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/" + TEMPLATE_LAND_USE_INITIAL_SUBDIVISION );
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/land_use_subdivision_year_of_change" );
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/" + TEMPLATE_SECOND_LU_CONVERSION );
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/" + TEMPLATE_SECOND_LU_CONVERSION_YEAR );
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/" + TEMPLATE_SECOND_LU_CHANGE );		
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/second_lu_subdivision" );
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/" + TEMPLATE_LAND_USE_CATEGORY_CHANGED );
		luDefaultAttributePaths.add( "/"+PLOT_ENTITY+"/" + TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED );

		for (String attributePath : luDefaultAttributePaths) {
			try {
				survey.getSchema().getDefinitionByPath(attributePath);
			} catch (InvalidPathException e) {
				throw new IPCCGeneratorException("Missing attribute in Survey : " + attributePath, e);
			}
		}


	}

	private void checkSurveyLUCodeLists(Survey survey) throws IPCCGeneratorException{

		ArrayList<String> luCodeLists = new ArrayList<String>();
		luCodeLists.add( CODE_LIST_LAND_USE );
		luCodeLists.add( CODE_LIST_LAND_USE_SUBCATEGORY );

		for (String codeList : luCodeLists) {
			try {
				survey.getCodeList( codeList );
			} catch (InvalidPathException e) {
				throw new IPCCGeneratorException("Missing Code List in Survey : " + codeList, e);
			}
		}
	}


}

package org.openforis.eye.service;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.util.Calendar;
import java.util.List;
import java.util.Map;

import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.persistence.RecordPersistenceException;
import org.openforis.collect.persistence.SurveyImportException;
import org.openforis.eye.model.Placemark;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.metamodel.xml.IdmlParseException;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.BooleanAttribute;
import org.openforis.idm.model.Code;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Coordinate;
import org.openforis.idm.model.CoordinateAttribute;
import org.openforis.idm.model.Date;
import org.openforis.idm.model.DateAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.IntegerAttribute;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.TextAttribute;
import org.openforis.idm.model.Value;
import org.springframework.beans.factory.annotation.Autowired;

public class EyeSurveyService {

	private static final String ROOT_ENTITY = "plot";

	private static final String EYE_SURVEY_NAME = "eye";

	@Autowired
	SurveyManager surveyManager;

	@Autowired
	RecordManager recordManager;

	@Autowired
	CollectParametersHandler collectParametersHandler;

	CollectSurvey collectSurvey;

	String idmFilePath;

	public EyeSurveyService(String idmFilePath) {
		super();
		this.idmFilePath = idmFilePath;
	}

	private String getIdmFilePath() {
		return idmFilePath;
	}

	private void setIdmFilePath(String idmFilePath) {
		this.idmFilePath = idmFilePath;
	}

	public void init() throws FileNotFoundException, IdmlParseException, SurveyImportException {
		collectSurvey = surveyManager.get(EYE_SURVEY_NAME);
		if (collectSurvey == null) {
			collectSurvey = surveyManager.unmarshalSurvey(new FileInputStream(new File(getIdmFilePath())));
			collectSurvey.setName(EYE_SURVEY_NAME);
			surveyManager.importModel(collectSurvey);
		}
	}

	public Map<String,String> getPlacemark(String placemarkId) {
		List<CollectRecord> summaries = recordManager.loadSummaries(collectSurvey, ROOT_ENTITY, placemarkId);
		CollectRecord record = null;
		Map<String, String> placemarkParameters = null;
		if (summaries.size() > 0) { // DELETE IF ALREADY PRESENT
			record = summaries.get(0);
			record = recordManager.load(collectSurvey, record.getId(), Step.ENTRY.getStepNumber());
			
			placemarkParameters = collectParametersHandler.getParameters(record.getRootEntity());

		}
		return placemarkParameters;
	}


	public void storePlacemark(Map<String, String> parameters, String sessionId) throws RecordPersistenceException {
		List<CollectRecord> summaries = recordManager
				.loadSummaries(collectSurvey, ROOT_ENTITY, parameters.get("collect_text_id"));

		CollectRecord record = null;
		if (summaries.size() > 0) { // DELETE IF ALREADY PRESENT
			record = summaries.get(0);
			recordManager.delete(record.getId());
		}

		// Create new record
		Schema schema = collectSurvey.getSchema();
		CollectRecord storeRecord = recordManager.create(collectSurvey, schema.getRootEntityDefinition(ROOT_ENTITY), null, null,
				sessionId);
		Entity plotEntity = storeRecord.getRootEntity();

		// Populate the data of the record using the HTTP parameters received
		collectParametersHandler.saveToEntity(parameters, plotEntity);

		recordManager.save(storeRecord, sessionId);
	}

	@SuppressWarnings("unchecked")
	private Placemark recordToPlacemark(CollectRecord record) {

		Placemark placemark = new Placemark();

		Entity plotEntity = record.getRootEntity();
		CodeAttribute idAttr = (CodeAttribute) plotEntity.get("id", 0);// SINGLE
																		// ATTRIBUTE
		Code idCode = idAttr.getValue();
		String idCodeValue = idCode.getCode();

		placemark.setId(plotEntity.getId());

		plotEntity.get("placemark_id", 0);
		List<Node<? extends NodeDefinition>> children = plotEntity.getChildren();
		for (Node<? extends NodeDefinition> child : children) {
			if( child instanceof Attribute ){
				Value value = ((Attribute<? extends AttributeDefinition, ? extends Value>) child).getValue();
				if(value instanceof Code){
					String code = ((Code) value).getCode();
				} 
			}
		}
		
		if( plotEntity.get("placemark_id", 0) != null ){
			placemark.setPlacemarkId(((TextAttribute) plotEntity.get("placemark_id", 0)).getValue().getValue());
		}
		
		if( plotEntity.get("location", 0) != null ){
			placemark.setLongitude(((CoordinateAttribute) plotEntity.get("location", 0)).getValue().getX() + "");
			placemark.setLatitude(((CoordinateAttribute) plotEntity.get("location", 0)).getValue().getY() + "");
		}

		if (plotEntity.get("operator", 0) != null) {
			placemark.setOperator(((TextAttribute) plotEntity.get("operator", 0)).getValue().getValue());
		}

		if (plotEntity.get("land_use", 0) != null) {
			placemark.setLandUse(((CodeAttribute) plotEntity.get("land_use", 0)).getValue().getCode());
		}
		
		if (plotEntity.get("land_use_type", 0) != null) {
			placemark.setLandUseType(((CodeAttribute) plotEntity.get("land_use_type", 0)).getValue().getCode());
		}
		
		if (plotEntity.get("topography_elements", 0) != null) {
			placemark.setTopographyCoverage(((CodeAttribute) plotEntity.get("topography_coverage", 0)).getValue().getCode());
		}
		
		if (plotEntity.get("topography_coverage", 0) != null) {
			placemark.setTopographyCoverage(((CodeAttribute) plotEntity.get("topography_coverage", 0)).getValue().getCode());
		}

		if (plotEntity.get("human_impact_grade", 0) != null) {
			placemark.setHumanImpactGrade(((CodeAttribute) plotEntity.get("human_impact_grade", 0)).getValue().getCode());
		}

		if (plotEntity.get("human_impact_year", 0) != null) {
			placemark.setHumanImpactYear(((IntegerAttribute) plotEntity.get("human_impact_year", 0)).getValue().getValue());
		}
		
		if (plotEntity.get("rs_date", 0) != null) {
			placemark.setRsDate(((DateAttribute) plotEntity.get("rs_date", 0)).getValue().toJavaDate());
		}

		if (plotEntity.get("rs_satellite", 0) != null) {
			placemark.setRsSatellite(((CodeAttribute) plotEntity.get("rs_satellite", 0)).getValue().getCode());
		}

		if (plotEntity.get("crown_cover", 0) != null) {
			placemark.setCrownCover(((CodeAttribute) plotEntity.get("crown_cover", 0)).getValue().getCode());
		}

		if (plotEntity.get("crown_type", 0) != null) {
			placemark.setCrownType(((CodeAttribute) plotEntity.get("crown_type", 0)).getValue().getCode());
		}

		if (plotEntity.get("actively_saved", 0) != null) {
			placemark.setActivelySaved(((BooleanAttribute) plotEntity.get("actively_saved", 0)).getValue().getValue());
		}

		// plotEntity.getAll(name) // Get multiple values of the same name
		return placemark;
	}

	private CollectRecord placemarkToRecord(Placemark placemark, String sessionId) throws RecordPersistenceException {
		Schema schema = collectSurvey.getSchema();
		CollectRecord storeRecord = recordManager.create(collectSurvey, schema.getRootEntityDefinition(ROOT_ENTITY), null, null,
				sessionId);
		Entity plotEntity = storeRecord.getRootEntity();

		EntityBuilder.addValue(plotEntity, "placemark_id", placemark.getPlacemarkId());
		EntityBuilder.addValue(plotEntity, "location",
				new Coordinate(Double.valueOf(placemark.getLongitude()), Double.valueOf(placemark.getLatitude()), "srs"));
		EntityBuilder.addValue(plotEntity, "operator", placemark.getOperator());
		if (placemark.getLandUse() != null) {
			EntityBuilder.addValue(plotEntity, "land_use", new Code(placemark.getLandUse()));
		}


		if (placemark.getLandUseChange() != null) {
			EntityBuilder.addValue(plotEntity, "land_use_change", placemark.getLandUseChange());
		}

		if (placemark.getLandUseType() != null) {
			EntityBuilder.addValue(plotEntity, "land_use_type", new Code(placemark.getLandUseType()));
		}

		if (placemark.getTopographyAccesibility() != null) {
			EntityBuilder.addValue(plotEntity, "topography_accessibility", new Code(placemark.getTopographyAccesibility()));
		}

		if (placemark.getTopographyElements() != null) {
			for (String topographyElement : placemark.getTopographyElements()) {
				EntityBuilder.addValue(plotEntity, "topography_elements", new Code(topographyElement));
			}

		}

		if (placemark.getTopographyCoverage() != null) {
			EntityBuilder.addValue(plotEntity, "topography_coverage", new Code(placemark.getTopographyCoverage()));
		}

		if (placemark.getHumanImpactType() != null) {
			for (String humanImpact : placemark.getHumanImpactType()) {
				EntityBuilder.addValue(plotEntity, "human_impact_type", new Code(humanImpact));
			}
		}

		if (placemark.getHumanImpactGrade() != null) {
			EntityBuilder.addValue(plotEntity, "human_impact_grade", new Code(placemark.getHumanImpactGrade()));
		}

		if (placemark.getHumanImpactYear() != null) {
			EntityBuilder.addValue(plotEntity, "human_impact_year", placemark.getHumanImpactYear());
		}

		if (placemark.getRsDate() != null) {
		
			Calendar cal = Calendar.getInstance();
			cal.setTime(placemark.getRsDate());
		    int year = cal.get(Calendar.YEAR);
		    int month = cal.get(Calendar.MONTH);
		    int day = cal.get(Calendar.DAY_OF_MONTH);


			EntityBuilder.addValue(plotEntity, "rs_date", new Date(year, month, day));
		}

		if (placemark.getRsSatellite() != null) {
			EntityBuilder.addValue(plotEntity, "rs_satellite", new Code(placemark.getRsSatellite()));
		}

		if (placemark.getCrownCover() != null) {
			EntityBuilder.addValue(plotEntity, "crown_cover", new Code(placemark.getCrownCover()));
		}

		if (placemark.getCrownType() != null) {
			EntityBuilder.addValue(plotEntity, "crown_type", new Code(placemark.getCrownType()));
		}

		if (placemark.isAcivelySaved() != null) {
			EntityBuilder.addValue(plotEntity, "actively_saved", placemark.isAcivelySaved());
		}

		return storeRecord;
	}
}

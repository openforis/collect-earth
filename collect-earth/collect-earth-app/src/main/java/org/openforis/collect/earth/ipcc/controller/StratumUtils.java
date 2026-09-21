package org.openforis.collect.earth.ipcc.controller;

import java.nio.charset.StandardCharsets;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.ipcc.model.StratumObject;
import org.openforis.idm.metamodel.CodeListItem;
import org.openforis.idm.metamodel.Survey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.thoughtworks.xstream.XStream;

public class StratumUtils {
	private static final String XML_DECLARATION = "<?xml version=" + (char) 34 + "1.0" + (char) 34 + " encoding=" + (char) 34 + "UTF-8" + (char) 34 + "?>\n";

	public static final String CODE_LIST_CLIMATE = "climate_zones";
	public static final String CODE_LIST_SOIL = "soil_types";
	public static final String CODE_LIST_GEZ = "ecological_zones";
	
	private static Logger logger = LoggerFactory.getLogger( StratumUtils.class );
	
	
	private static List<StratumObject> getCodeList(Survey survey, String codeList ) {
		List<CodeListItem> items = survey.getCodeList( codeList  ).getItems();
		List<StratumObject> itemsInfo = new ArrayList<StratumObject>();
		for (CodeListItem item : items) {
			itemsInfo.add( new StratumObject(item.getCode(), item.getLabel(), item.getDescription() ) );
		}
		return itemsInfo;
	}
	
	public static File getClimateZonesXML( Survey survey ) throws IOException {
		return getStratumXML(survey, CODE_LIST_CLIMATE, "climate");
	}
	
	public static File getEcologicalZonesXML(Survey survey) throws IOException {
		return getStratumXML(survey, CODE_LIST_GEZ, "gez");
	}
	
	public static File getSoilTypesXML(Survey survey) throws IOException {
		return getStratumXML(survey, CODE_LIST_SOIL, "soil");
	}
	
	private static File getStratumXML( Survey survey, String codeList, String nameForXml ) throws IOException {
		XStream xStream = new XStream();
		
		xStream.alias(nameForXml, StratumObject.class);
		
		xStream.setMode(XStream.NO_REFERENCES);
		String xmlSchema = xStream.toXML( getCodeList(survey, codeList));
		
		File xmlFileDestination = File.createTempFile( "codeListInSurvey", ".xml" );
		xmlFileDestination.deleteOnExit();
		try (FileOutputStream outputStream = new FileOutputStream( xmlFileDestination ) ) {
			// UTF-8, and say so in the file : with the charset of the machine an accented label of a code list was written in
			// one encoding and read as another, which makes the XML unreadable
			outputStream.write(XML_DECLARATION.getBytes(StandardCharsets.UTF_8));
			outputStream.write(xmlSchema.getBytes(StandardCharsets.UTF_8));
		} catch (Exception e) {
			logger.error("Error saving data to file", e);
		}
		
		return xmlFileDestination;
	}

}

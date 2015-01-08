package org.openforis.collect.earth.app.service;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.io.StringReader;
import java.io.StringWriter;

import javax.swing.JFrame;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.DataFormat;
import org.openforis.collect.earth.app.view.JFileChooserExistsAware;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.w3c.dom.Attr;
import org.w3c.dom.Document;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;

@Component
public class KmlImportService {

	@Autowired
	LocalPropertiesService localPropertiesService;
	
	@Autowired
	EarthProjectsService earthProjectsService;

	private JFrame frame;

	/*
	 * 
	 <Placemark>
			<name>one</name>
			<LookAt>
				<longitude>-5.89991123135449</longitude>
				<latitude>41.60459478540565</latitude>
				<altitude>0</altitude>
				<heading>-1.425202537313517e-006</heading>
				<tilt>0</tilt>
				<range>177418.783783632</range>
				<gx:altitudeMode>relativeToSeaFloor</gx:altitudeMode>
			</LookAt>
			<styleUrl>#m_ylw-pushpin</styleUrl>
			<Point>
				<gx:drawOrder>1</gx:drawOrder>
				<coordinates>-5.899911231354489,41.60459478540565,0</coordinates>
			</Point>
		</Placemark>
	 * 
	 * 
	 */
	
	private File createTempCsv( File kmlFile) throws ParserConfigurationException, SAXException, IOException{

		DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        DocumentBuilder builder = factory.newDocumentBuilder();
        InputSource is = new InputSource(new FileReader(kmlFile));
        Document doc = builder.parse(is);

        NodeList placemarks = doc.getElementsByTagName("Placemark");

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < placemarks.getLength(); i++) {                
            Node placemark = placemarks.item(i);

                   
            if (placemark.hasChildNodes()) {
            	NodeList childNodes = placemark.getChildNodes();
            	String longitude = "",latitude = "",name = ""; 
            	for (int j=0; j<childNodes.getLength(); j++){
            		
            		Node placemarkChild = childNodes.item(j);
            		
            		if( placemarkChild.getNodeName().equals("name")){
            			name = placemarkChild.getFirstChild().getTextContent();
            		}else if ( placemarkChild.getNodeName().equals("Point")){
            			NodeList lookAtNodes  = placemarkChild.getChildNodes();
                    	
                    	for (int h=0; h<lookAtNodes.getLength(); h++){
                    		Node lookAtChild = lookAtNodes.item(h);                  		
		            		if( lookAtChild.getNodeName().equals("coordinates" ) ){
		            			String coordinates = lookAtChild.getFirstChild().getTextContent();
		            			
		            			String[] splitCoords = coordinates.split(",");
		            			
		            			longitude = splitCoords[0];
		            			latitude = splitCoords[1];
		            		}
                    	}                    	
            		}            		
            	}
            	
            	sb.append( name ).append( i ).append(",").append( latitude ).append(",").append( longitude ).append(",0,0,0,0,0,0,0,0\r\n");
            }
        }
        
        File tempFile = File.createTempFile("kmlExtractedPoints", "csv");
        FileWriter fw = new FileWriter(tempFile);
		BufferedWriter bw = new BufferedWriter(fw);
		bw.write(sb.toString());
		bw.close();
        
        return tempFile;

	}

	public void loadFromKml( JFrame frame) throws ParserConfigurationException, SAXException, IOException{
		this.frame = frame;
		// Choose the file in the file system
		File kmlFile = chooseKmlFile();
		if( kmlFile != null ){
			// Convert the KML into a CSV and save it into a temporary file
			File convertedCsvFile = createTempCsv( kmlFile );

			// Move the temporary file to the current project folder
			File finalCsvFile = moveCsvToProjectFolder(convertedCsvFile, kmlFile.getName());

			// Load the plots from the CSV 
			localPropertiesService.setValue(EarthProperty.CSV_KEY, finalCsvFile.getAbsolutePath());
		}
	}

	private File moveCsvToProjectFolder(File convertedCsvFile, String originalKmlFilename) throws IOException {
		File destination = new File( earthProjectsService.getProjectsFolder() + File.separator + "generatedFromKml_" + originalKmlFilename + ".ced");
		FileUtils.copyFile( convertedCsvFile, destination);
		return destination;
	}

	private File chooseKmlFile() {
		final File[] selectedPlotFiles = JFileChooserExistsAware.getFileChooserResults(DataFormat.KML_FILE, false, false, null,
				localPropertiesService, frame);

		if( selectedPlotFiles != null && selectedPlotFiles.length == 1 ){
			return selectedPlotFiles[0];
		}else 
			return null;
	}

}

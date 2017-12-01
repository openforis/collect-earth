package org.openforis.collect.earth.app.service;

import java.io.BufferedInputStream;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.util.HashMap;
import java.util.Map;

import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.DataFormat;
import org.openforis.collect.earth.app.view.JFileChooserExistsAware;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.io.metadata.collectearth.CollectEarthGridTemplateGenerator;
import org.openforis.collect.io.metadata.collectearth.CollectEarthProjectFileCreator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;

@Component
public class KmlImportService {
	
	Map<String,Integer> namesAndTimes = new HashMap<String,Integer>();

	@Autowired
	LocalPropertiesService localPropertiesService;
	
	@Autowired
	EarthProjectsService earthProjectsService;
	
	@Autowired
	EarthSurveyService earthSurveyService;

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

        NodeList placemarks = doc.getElementsByTagName("Placemark"); //$NON-NLS-1$

        StringBuilder sb = new StringBuilder();
        
        sb.append( CollectEarthProjectFileCreator.PLACEHOLDER_ID_COLUMNS_HEADER ).append(",").append( "YCoordinate" ).append(",").append( "XCoordinate" ).append(CollectEarthProjectFileCreator.PLACEHOLDER_FOR_EXTRA_COLUMNS_HEADER).append( "\r\n"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
        
        
        for (int i = 0; i < placemarks.getLength(); i++) {                
            Node placemark = placemarks.item(i);

                   
            if (placemark.hasChildNodes()) {
            	NodeList childNodes = placemark.getChildNodes();
            	String longitude = "",latitude = "",name = "Placemark";  //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
            	for (int j=0; j<childNodes.getLength(); j++){
            		name = "placemark" + j;
            		Node placemarkChild = childNodes.item(j);
            		
            		if ( placemarkChild.getNodeName().equalsIgnoreCase("Point")){ //$NON-NLS-1$
            			String coordinates = processPoint(placemarkChild); 
                    	
                    	String[] splitCoords = coordinates.split(","); //$NON-NLS-1$
            			
            			longitude = splitCoords[0];
            			latitude = splitCoords[1];
            		}else if ( placemarkChild.getNodeName().equalsIgnoreCase("Multigeometry")){ //$NON-NLS-1$ // Special case forQGis generatedKML
            			
            			NodeList childMultigemoetryNodes = placemarkChild.getChildNodes();
                    	
                    	for (int t=0; t<childMultigemoetryNodes.getLength(); t++){
                    		
                    		Node multigeometryChild = childMultigemoetryNodes.item(t);
                    		 if ( multigeometryChild.getNodeName().equals("Point")){ //$NON-NLS-1$
                     			String coordinates = processPoint(multigeometryChild); 
                             	
                             	String[] splitCoords = coordinates.split(","); //$NON-NLS-1$
                     			
                     			longitude = splitCoords[0];
                     			latitude = splitCoords[1];
                    		 }
                    	}
            		}else if ( placemarkChild.getNodeName().equalsIgnoreCase("name")){ //$NON-NLS-1$
            			name = placemarkChild.getFirstChild().getNodeValue();
            		}
            	}
            	            	
            	sb.append(name).append( CollectEarthProjectFileCreator.PLACEHOLDER_ID_COLUMNS_VALUES ).append("_").append( i+1 ).append(",").append( latitude ).append(",").append( longitude ).append(CollectEarthProjectFileCreator.PLACEHOLDER_FOR_EXTRA_COLUMNS_VALUES).append( "\r\n"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
            }
        }
        
        File tempFile = File.createTempFile("kmlExtractedPointsTemplate", "csv"); //$NON-NLS-1$ //$NON-NLS-2$
        
        OutputStreamWriter osw = new OutputStreamWriter(  new FileOutputStream( tempFile ), "UTF-8" );

		BufferedWriter bw = new BufferedWriter(osw);
		bw.write(sb.toString());
		bw.close();
        
		
		BufferedInputStream bis = new BufferedInputStream( new FileInputStream(tempFile) );
		
		CollectEarthGridTemplateGenerator generator = new CollectEarthGridTemplateGenerator();
		return generator.generateTemplateCSVFile(earthSurveyService.getCollectSurvey(), bis);
	}

	public String processPoint(Node placemarkChild) {
		NodeList lookAtNodes  = placemarkChild.getChildNodes();
		String coordinates = null;
		for (int h=0; h<lookAtNodes.getLength(); h++){
			Node lookAtChild = lookAtNodes.item(h);		
			if( lookAtChild.getNodeName().equalsIgnoreCase("coordinates" ) ){ //$NON-NLS-1$
				 coordinates = lookAtChild.getFirstChild().getNodeValue();
			}
		}
		return coordinates;
	}

	public boolean prompToOpenKml( JFrame frame) throws ParserConfigurationException, SAXException, IOException{
		this.frame = frame;
		// Choose the file in the file system
		File kmlFile = chooseKmlFile();
		boolean kmlImported = false;
		if( kmlFile != null ){
			kmlImported = loadFromKml(frame, kmlFile);
		}
		
		return kmlImported;
	}
	
	
	public boolean loadFromKml( JFrame frame, File kmlFile) throws ParserConfigurationException, SAXException, IOException{

			// Convert the KML into a CSV and save it into a temporary file
			File convertedCsvFile = createTempCsv( kmlFile );

			JOptionPane.showMessageDialog(frame, Messages.getString("KmlImportService.13")); //$NON-NLS-1$
			
			// Move the temporary file to the current project folder
			//File finalCsvFile = moveCsvToProjectFolder(convertedCsvFile, kmlFile.getName());
			File finalCsvFile = selectAndSaveToCsv(convertedCsvFile, kmlFile.getName());

			boolean loaded = false;
			if( finalCsvFile != null ){
				// Load the plots from the CSV 
				localPropertiesService.setValue(EarthProperty.SAMPLE_FILE, finalCsvFile.getAbsolutePath());
				loaded = true;
			}
			
			return loaded;
	}

	private File selectAndSaveToCsv(File convertedCsvFile, String name) throws IOException {
		final File[] saveToCsvFile = JFileChooserExistsAware.getFileChooserResults(DataFormat.COLLECT_COORDS, true, false, "importedFromKml_" + name + ".csv", //$NON-NLS-1$ //$NON-NLS-2$
				localPropertiesService, frame);

		if( saveToCsvFile != null && saveToCsvFile.length == 1 ){
			FileUtils.copyFile( convertedCsvFile, saveToCsvFile[0]);
			return saveToCsvFile[0];
		}else 
			return null;
	}

/*	private File moveCsvToProjectFolder(File convertedCsvFile, String originalKmlFilename) throws IOException {
		File destination = new File( earthProjectsService.getProjectsFolder() + File.separator + "generatedFromKml_" + originalKmlFilename + ".ced");
		FileUtils.copyFile( convertedCsvFile, destination);
		return destination;
	}*/

	private File chooseKmlFile() {
		final File[] selectedPlotFiles = JFileChooserExistsAware.getFileChooserResults(DataFormat.KML_FILE, false, false, null,
				localPropertiesService, frame);

		if( selectedPlotFiles != null && selectedPlotFiles.length == 1 ){
			return selectedPlotFiles[0];
		}else 
			return null;
	}


}

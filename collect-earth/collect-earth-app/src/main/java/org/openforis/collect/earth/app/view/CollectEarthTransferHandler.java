package org.openforis.collect.earth.app.view;

import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.Transferable;
import java.awt.datatransfer.UnsupportedFlavorException;
import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.LinkedList;
import java.util.List;

import javax.swing.JComponent;
import javax.swing.TransferHandler;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class CollectEarthTransferHandler extends TransferHandler {


	private CollectEarthWindow collectEarthWindow;
	private LocalPropertiesService localPropertiesService;

	public static final String MIME_URI_LIST = "uri-list";

	public CollectEarthTransferHandler(CollectEarthWindow collectEarthWindow, LocalPropertiesService localPropertiesService) {
		super();
		this.collectEarthWindow = collectEarthWindow;
		this.localPropertiesService = localPropertiesService;
	}


	/**
	 * 
	 */
	private static final long serialVersionUID = 1L;
	Logger logger = LoggerFactory.getLogger( CollectEarthTransferHandler.class);

	/* 
	 * Can Only import an object if it represents a SINGLE file
	 * (non-Javadoc)
	 * @see javax.swing.TransferHandler#canImport(javax.swing.TransferHandler.TransferSupport)
	 */
	@Override
	public boolean canImport(TransferSupport support) {

		try{
			List<?> files = getDropList(support); 
			if (files == null || files.isEmpty()) return false; 
			if (files.size() != 1) return false; //handle multiple files down the road 
			Object o = files.get(0); 
			if (o instanceof File) 
			{ 
				return isFileExtensionValid( (File) o) ; 
			} 
			if (o instanceof URI) 
			{ 
				return isFileExtensionValid( new File( (URI) o) ) ; 
			} 
		}catch(Exception e ){
			logger.error("Error deciding if the drop event is importable", e );
		}
		return false; 

	}
	@SuppressWarnings("static-method") 
	public boolean isDataFlavorSupported(DataFlavor df) 
	{ 
		return df.isFlavorJavaFileListType() 
				|| (df.isRepresentationClassReader() && MIME_URI_LIST.equals(df.getSubType())); 
	}
	protected DataFlavor getSupportedFlavor(DataFlavor...dfs) 
	{ 
		for (DataFlavor df : dfs) 
			if (isDataFlavorSupported(df)) return df;  
		return null; 
	} 

	private List<?> getDropList(TransferHandler.TransferSupport evt) 
	{ 
		Transferable tr = evt.getTransferable(); 
		DataFlavor df = getSupportedFlavor(evt.getDataFlavors()); 
		if (df == null) return null; 
		try 
		{ 
			
			if (df.isFlavorTextType()) 
				return (List<?>) tr.getTransferData(DataFlavor.javaFileListFlavor); 

			//Linux support (uri-list reader) 
			if (!df.isRepresentationClassReader() || !MIME_URI_LIST.equals(df.getSubType())) 
				return null; //Or not? Let implementation handle it. 
			 
			BufferedReader br = new BufferedReader(df.getReaderForText(tr)); 
			List<URI> uriList = new LinkedList<URI>(); 
			String line; 
			while ((line = br.readLine()) != null) 
			{ 
				try 
				{ 
					// kde seems to append a 0 char to the end of the reader 
					if (line.isEmpty() || line.length() == 1 && line.charAt(0) == (char) 0) continue; 
					uriList.add(new URI(line)); 
				} 
				catch (URISyntaxException ex) 
				{ 
					//Omit bad URI files from list. 
				} 
				catch (IllegalArgumentException ex) 
				{ 
					//Omit unresolvable URLs from list. 
				} 
			} 
			br.close(); 
			return uriList; 
		} 
		catch (UnsupportedFlavorException e) 
		{ 
			logger.error("The flavor is not supported " , e);
		} 
		catch (IOException e) 
		{ 
			logger.error("Problem reading the object " , e);
		} 
		return null; 
	}


	private String getFileExtension(File file) {
		String fileName = file.getName();
		int lastIndexOf = fileName.lastIndexOf('.' );
		String fileExtenxion = null;
		if( lastIndexOf >0 ){
			fileExtenxion = fileName.substring( lastIndexOf + 1 );
		}
		return fileExtenxion;
	}


	private boolean isFileExtensionValid(File file ){
		String fileExtension = getFileExtension(file);
		return fileExtension!=null && ( DataFormat.COLLECT_COORDS.checkFileExtensionMatches(fileExtension) || DataFormat.PROJECT_DEFINITION_FILE.checkFileExtensionMatches(fileExtension) );
	}

	/* 
	 * We support both copy and move actions.
	 * (non-Javadoc)
	 * @see javax.swing.TransferHandler#getSourceActions(javax.swing.JComponent)
	 */
	public int getSourceActions(JComponent c) {
		return COPY_OR_MOVE;
	}


	/* 
	 * Perform the actual import.  This demo only supports drag and drop.
	 * (non-Javadoc)
	 * @see javax.swing.TransferHandler#importData(javax.swing.TransferHandler.TransferSupport)
	 */
	public boolean importData(TransferSupport support) {
		if (!support.isDrop()) {
			return false;
		}

		List<?> files = getDropList(support); 
		if (files == null || files.isEmpty()) return false; 
		if (files.size() != 1) return false; //handle multiple files down the road 
		Object o = files.get(0); 
		try {
			if (o instanceof File) { 
				return importFile( (File) o) ; 
			} else if (o instanceof URI){ 
				return importFile( new File( (URI) o) ) ; 
			} else{
				return false; 
			}
		} catch (Exception e) {
			logger.error( "Error while imprted Drag and Drop file " , e);
		}
		return false;
	}

	private boolean importFile(File fileToImport) throws MalformedURLException, IOException{
		if( !isFileExtensionValid(fileToImport)){
			throw new IllegalArgumentException("The drop action supports only files of type!" + DataFormat.COLLECT_COORDS + " or " + DataFormat.PROJECT_DEFINITION_FILE);
		}

		String fileExtension = getFileExtension(fileToImport);

		// If it is a CEP file then import
		if( DataFormat.PROJECT_DEFINITION_FILE.checkFileExtensionMatches(fileExtension)){
			EarthApp.openProjectFileInRunningCollectEarth( fileToImport.getAbsolutePath() );
		}else if( DataFormat.COLLECT_COORDS.checkFileExtensionMatches(fileExtension)){

			// Check if the CSV file can be loaded in the survey!!!

			try{
				if( CollectEarthUtils.validateCsvColumns( fileToImport ) ){

					localPropertiesService.setValue( EarthProperty.SAMPLE_FILE, fileToImport.getAbsolutePath() );
					EarthApp.executeKmlLoadAsynchronously( collectEarthWindow.getFrame() );
				}

			}catch( KmlGenerationException kmlGenerationException ){
				logger.error( "Problem loading CSV file dropped into the window" , kmlGenerationException );
				EarthApp.showMessage(" Problem loading CSV file" + kmlGenerationException.getCause() );
			}


		}else{
			throw new IllegalArgumentException("Unknown file extension!! Neither Mac/Linux now Windows detected");
		}

		return true;

	}
}	


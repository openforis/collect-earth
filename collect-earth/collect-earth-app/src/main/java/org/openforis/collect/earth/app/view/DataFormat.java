package org.openforis.collect.earth.app.view;

import java.io.File;
import java.util.Arrays;

public enum DataFormat{
	PROJECT_DEFINITION_FILE(
			new String[]{"cep"}, Messages.getString("JFileChooserExistsAware.0")), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			ZIP_WITH_XML(new String[]{"zip", "collect-data"},Messages.getString("CollectEarthWindow.48")), //$NON-NLS-1$ //$NON-NLS-2$
			CSV(new String[]{"csv"}, Messages.getString("CollectEarthWindow.38")), //$NON-NLS-1$ //$NON-NLS-2$
			FUSION(new String[]{"csv"}, Messages.getString("CollectEarthWindow.49")), //$NON-NLS-1$ //$NON-NLS-2$
			COLLECT_COORDS(new String[]{"ced", "csv"}, "Collect Earth plots"),//$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			KML_FILE(new String[]{"kml"}, "Google Earth Kml File"), //$NON-NLS-1$ //$NON-NLS-2$
			COLLECT_BACKUP(new String[]{"collect-data"}, "Collect Backup"),
			SAIKU_ZIP( new String[] {"zip"},  "ZIP Saiku Tool Export" ),
			GHGI_ZIP_FILE(new String[]{"zip"}, "IPCC GHGi Tool Package"); //$NON-NLS-1$ //$NON-NLS-2$

	private String[] fileExtension;
	private String description;
	
	private DataFormat(String[] fileExtension, String description) {
		this.fileExtension = fileExtension;
		this.description = description;
	}

	public String[] getPossibleFileExtensions() {
		return fileExtension;
	}
	
	public String getDefaultExtension() {
		return fileExtension[0];
	}
	
	
	public String getDescription() {
		return description;
	}
	
	/**
	 * Appends the default extension of this format to a file that does not already carry one of its possible extensions.
	 *
	 * @param file The file chosen by the user
	 * @return The file that will really be written
	 */
	public File withDefaultExtension( File file ){
		String fileName = file.getAbsolutePath();
		int lastDot = fileName.lastIndexOf('.');
		String extensionOfFile = lastDot == -1 ? null : fileName.substring( lastDot + 1 );
		// checkFileExtensionMatches compares every possible extension, ignoring case. A binary search was used here, over an
		// unsorted array, so a valid ".collect-data" file was renamed to ".zip"
		if( extensionOfFile == null || !checkFileExtensionMatches( extensionOfFile ) ){
			return new File( fileName + "." + getDefaultExtension() ); //$NON-NLS-1$
		}
		return file;
	}

	public boolean checkFileExtensionMatches( String fileExtensionToCheck){
		for (String ext : fileExtension) {
			if( ext.equalsIgnoreCase( fileExtensionToCheck)){
				return true;
			}
		}
		return false;
	}
	
	@Override
	public String toString() {
		return Arrays.toString(fileExtension);
	}

}
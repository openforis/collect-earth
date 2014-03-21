package org.openforis.collect.earth.app.view;

import java.io.File;
import java.util.Arrays;

import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.swing.filechooser.FileFilter;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

public class JFileChooserExistsAware extends JFileChooser {

	private static final long serialVersionUID = 1L;

	private JFileChooserExistsAware(File lastFolder) {
		super(lastFolder);		
	}

	private JFileChooserExistsAware() {
		super();
	}

	@Override
	public void approveSelection(){
		File f = getSelectedFile();
		if(f.exists() && getDialogType() == SAVE_DIALOG){
			int result = JOptionPane.showConfirmDialog(this,"The file exists, overwrite?","Existing file",JOptionPane.YES_NO_CANCEL_OPTION); //$NON-NLS-1$ //$NON-NLS-2$
			switch(result){
			case JOptionPane.YES_OPTION:
				super.approveSelection();
				return;
			case JOptionPane.NO_OPTION:
				return;
			case JOptionPane.CLOSED_OPTION:
				return;
			case JOptionPane.CANCEL_OPTION:
				cancelSelection();
				return;
			}
		}
		super.approveSelection();
	}        
	
	public static File[] getFileChooserResults(final DataFormat dataFormat, boolean isSaveDlg, boolean multipleSelect, String preselectedName, LocalPropertiesService localPropertiesService, JFrame frame) {

		JFileChooser fc ;

		String lastUsedFolder = localPropertiesService.getValue( EarthProperty.LAST_USED_FOLDER );
		if( !StringUtils.isBlank( lastUsedFolder ) ){
			File lastFolder = new File( lastUsedFolder );
			if(lastFolder.exists() ){
				fc= new JFileChooserExistsAware( lastFolder );
			}else{
				fc= new JFileChooserExistsAware( );
			}

		}else{
			fc = new JFileChooserExistsAware();
		}
		
		if( preselectedName != null ){
			File selectedFile = new File( fc.getCurrentDirectory().getAbsolutePath() + File.separatorChar + preselectedName );
			fc.setSelectedFile( selectedFile );
		}

		fc.setMultiSelectionEnabled( multipleSelect );

		File[] selectedFiles = null;
		fc.addChoosableFileFilter(new FileFilter() {

			@Override
			public boolean accept(File f) {
				
				String[] extensions = dataFormat.getPossibleFileExtensions();
				boolean acceptedFile = false;
				boolean isFolder = f.isDirectory();
				if( isFolder ){
					acceptedFile = true;
				}else{
					
					for (String fileExtension : extensions) {
						if( f.getName().toLowerCase().endsWith("." + fileExtension ) ){ //$NON-NLS-1$
							acceptedFile = true;
							break;
						}
					}
				}
				
				return acceptedFile;
			}

			@Override
			public String getDescription() {
				String description = ""; //$NON-NLS-1$
				if( dataFormat.equals( DataFormat.CSV ) ){
					description = Messages.getString("CollectEarthWindow.38"); //$NON-NLS-1$
				}else if( dataFormat.equals( DataFormat.ZIP_WITH_XML ) ){
					description = Messages.getString("CollectEarthWindow.48"); //$NON-NLS-1$
				}else if( dataFormat.equals( DataFormat.FUSION ) ){
					description = Messages.getString("CollectEarthWindow.49"); //$NON-NLS-1$
				}
				return description;
			}
		});

		fc.setAcceptAllFileFilterUsed(true);

		// Handle open button action.
		int returnVal ;
		if( isSaveDlg ){
			returnVal = fc.showSaveDialog( frame );
		}else{
			returnVal = fc.showOpenDialog( frame);
		}

		if ( returnVal == JFileChooser.APPROVE_OPTION) {

			if( isSaveDlg ){
				selectedFiles = new File[]{ fc.getSelectedFile() };
				String file_name = selectedFiles[0].getAbsolutePath();
				
				String fileExtension = null;
				
				if( file_name.lastIndexOf('.') != -1){
					fileExtension = file_name.substring( file_name.lastIndexOf('.') + 1 ).toLowerCase();
				}
				
				// If the chose file has no extension or the extension is not one of the default extensions for the dataformat
				if ( fileExtension == null || Arrays.binarySearch( dataFormat.getPossibleFileExtensions(), fileExtension ) < 0 ) { //$NON-NLS-1$
					file_name += "." + dataFormat.getDefaultExtension(); //$NON-NLS-1$
					selectedFiles[0] = new File(file_name);
				}
			}else{
				selectedFiles = fc.getSelectedFiles();
			}

			localPropertiesService.setValue(EarthProperty.LAST_USED_FOLDER, selectedFiles[0].getParent());


		}
		return selectedFiles;
	}

}

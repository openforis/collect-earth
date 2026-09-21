package org.openforis.collect.earth.app.view;

import java.io.File;

import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.swing.filechooser.FileFilter;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

public class JFileChooserExistsAware extends JFileChooser {

	private static final long serialVersionUID = 2571562963995019882L;

	private final transient DataFormat saveDataFormat;

	private JFileChooserExistsAware(File lastFolder, DataFormat saveDataFormat) {
		super(lastFolder);
		this.saveDataFormat = saveDataFormat;
	}

	@Override
	public void approveSelection(){
		File f = getSelectedFile();
		if( f!=null && getDialogType() == SAVE_DIALOG && saveDataFormat != null ){
			// Work out the name that will really be written before asking about overwriting : typing "export" where "export.zip"
			// exists used to overwrite it without a word, because the extension was added after this question
			f = saveDataFormat.withDefaultExtension( f );
			setSelectedFile( f );
		}
		if( f!=null && f.exists() && getDialogType() == SAVE_DIALOG){
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
		return getFileChooserResults(dataFormat, isSaveDlg, multipleSelect, preselectedName, localPropertiesService, frame, null);
	}

	public static File[] getFileChooserResults(final DataFormat dataFormat, boolean isSaveDlg, boolean multipleSelect, String preselectedName, LocalPropertiesService localPropertiesService, JFrame frame, File preSelectedFolder) {

		JFileChooser fc ;

		if( preSelectedFolder == null ){
			String lastUsedFolder = localPropertiesService.getValue( EarthProperty.LAST_USED_FOLDER );
			if( !StringUtils.isBlank( lastUsedFolder ) ){
				preSelectedFolder = new File( lastUsedFolder );
				if( !preSelectedFolder.exists()){
					preSelectedFolder = null;
				}
			}
		}

		fc = new JFileChooserExistsAware( preSelectedFolder, isSaveDlg ? dataFormat : null );

		if( preselectedName != null ){
			File selectedFile = new File( fc.getCurrentDirectory().getAbsolutePath() + File.separatorChar + preselectedName );
			fc.setSelectedFile( selectedFile );
		}

		fc.setMultiSelectionEnabled( multipleSelect );

		File[] selectedFiles = null;
		FileFilter addedFilter = getFileFilter(dataFormat);
		fc.addChoosableFileFilter(addedFilter);

		fc.setAcceptAllFileFilterUsed(true);
		// Set the added file filter as the default chose filter
		fc.setFileFilter(addedFilter);

		// Handle open button action.
		int returnVal ;
		if( isSaveDlg ){
			returnVal = fc.showSaveDialog( frame );
		}else{
			returnVal = fc.showOpenDialog( frame);
		}

		if ( returnVal == JFileChooser.APPROVE_OPTION) {

			if( multipleSelect ){
				selectedFiles = fc.getSelectedFiles();
			}else{
				selectedFiles = new File[]{fc.getSelectedFile()};
			}
			
			if( selectedFiles != null && selectedFiles.length > 0 ) {
				if( isSaveDlg ){
					// approveSelection has already done this for the file the user typed, this covers the other ways in
					selectedFiles[0] = dataFormat.withDefaultExtension( selectedFiles[0] );
				}
				
				localPropertiesService.setValue(EarthProperty.LAST_USED_FOLDER, selectedFiles[0].getParent());
			}


		}
		return selectedFiles;
	}

	private static FileFilter getFileFilter(final DataFormat dataFormat) {
		return new FileFilter() {

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
				return dataFormat.getDescription();
			}
		};
	}

}

package org.openforis.collect.earth.app.view;

import java.awt.Toolkit;
import java.io.File;
import java.io.IOException;
import java.util.List;
import java.util.Observable;
import java.util.Observer;
import java.util.Random;

import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;

import net.lingala.zip4j.core.ZipFile;
import net.lingala.zip4j.exception.ZipException;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.io.data.DataImportState;
import org.openforis.collect.io.data.DataImportSummaryItem;
import org.openforis.collect.io.data.XMLDataImportProcess;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.common.io.Files;

public class ImportXMLDialogProcessMonitor implements Observer{

	private static final Logger logger = LoggerFactory.getLogger(ImportXMLDialogProcessMonitor.class);
	private InfiniteProgressMonitor progressMonitor;

	public void closeProgressmonitor() {

		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				if (progressMonitor != null) {
					progressMonitor.close();
				}}
		});
	}

	private boolean shouldAddConflictingRecords(List<DataImportSummaryItem> listConflictingRecords, String importedFileName) {

		if (listConflictingRecords.size() > 0) {

			Object[] options = {Messages.getString("ImportXMLDialogProcessMonitor.1"), Messages.getString("ImportXMLDialogProcessMonitor.2")};
			
			final int selectedOption = JOptionPane.showOptionDialog(null,

					"<html>" //$NON-NLS-1$
					+ "<b>" + importedFileName + " : </b></br>" //$NON-NLS-1$ //$NON-NLS-2$
					+ Messages.getString("CollectEarthWindow.9") //$NON-NLS-1$
					+ "<br>" //$NON-NLS-1$
					+ Messages.getString("CollectEarthWindow.20") + listConflictingRecords.size()  //$NON-NLS-1$
					+ "<br>" //$NON-NLS-1$
					+ Messages.getString("CollectEarthWindow.25") //$NON-NLS-1$
					+ "<br>" //$NON-NLS-1$
					+ "<i>" //$NON-NLS-1$
					+ Messages.getString("CollectEarthWindow.39") //$NON-NLS-1$
					+ "</i>" //$NON-NLS-1$
					+ "</html>",  //$NON-NLS-1$

					Messages.getString("CollectEarthWindow.43"), //$NON-NLS-1$

					JOptionPane.YES_NO_OPTION,
				    JOptionPane.QUESTION_MESSAGE,
				    null,     //do not use a custom Icon
				    options,  //the titles of buttons
				    options[1] //default button title
			);

			return (selectedOption == JOptionPane.YES_OPTION);
		} else {
			return false;
		}
	}

	public synchronized void startImport(final XMLDataImportProcess importProcess, final JFrame parentFrame,
			final DataImportExportService dataImportService, final File importedFile ) {

		try {

			SwingUtilities.invokeLater(new Runnable() {
				@Override
				public void run() {

					progressMonitor = new InfiniteProgressMonitor(parentFrame, Messages.getString("ImportDialogProcessMonitor.8") + "(" //$NON-NLS-1$ //$NON-NLS-2$
							+ importedFile.getName() + ")", Messages.getString("ImportDialogProcessMonitor.11") + Messages.getString("ImportDialogProcessMonitor.0")); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					progressMonitor.show();

					if (progressMonitor != null && progressMonitor.isUserCancelled()) {

						Toolkit.getDefaultToolkit().beep();
						importProcess.cancel();
						logger.warn("Import Task canceled.\n"); //$NON-NLS-1$

					}
				}
			});
			
			File definitiveFileToImport = importedFile;
			// If the file is exported from Collect rather than a XML export from Collect Earth
			if( isCollectDataExport( definitiveFileToImport ) ){
				// Transform the file to a Collect Earth type of format
				definitiveFileToImport = transformCollectDataFile( definitiveFileToImport );
				importProcess.setFile( definitiveFileToImport );
			}
			
			importProcess.callAndObserve( this );

			if (importProcess.getSummary() != null && !importProcess.getState().isCancelled()) {

				final List<DataImportSummaryItem> conflictingRecords = importProcess.getSummary().getConflictingRecords();

				if ( conflictingRecords != null && conflictingRecords.size() > 0) {

					if (!shouldAddConflictingRecords(conflictingRecords, definitiveFileToImport.getName())) {
						conflictingRecords.clear();
					}
				}
				final int totalRecords = ( conflictingRecords==null?0:conflictingRecords.size() ) + importProcess.getSummary().getRecordsToImport().size();
				SwingUtilities.invokeLater(new Runnable() {
					@Override
					public void run() {
						progressMonitor.setMessage( Messages.getString("ImportDialogProcessMonitor.11") + totalRecords ); //$NON-NLS-1$
					}	});

				dataImportService.importRecordsFrom(definitiveFileToImport, importProcess, conflictingRecords );
				
				forceRefreshGoogleEarth();
			}
		} catch (final Exception e1) {
			logger.error("", e1); //$NON-NLS-1$
		} finally {
			closeProgressmonitor();
		}

	}
	
	
	private boolean isCollectDataExport(File importedFile) {
		return importedFile.getName().endsWith(".collect-data");
	}
	
	private File transformCollectDataFile(File zipWithXml) throws ZipException, IOException {
		
		
		// Originally the collect-data file will look like this:
		// root: idml.xml
		// root : data (folder)
		// root : data/1 (folder)
		// the XML files will be under the data
		File dst = null;
		File tempFolder = null;
		try {
			ZipFile src = new ZipFile( zipWithXml );
			tempFolder = Files.createTempDir();
			src.extractAll( tempFolder.getAbsolutePath() );
			
			
			dst = new File( tempFolder.getParentFile(), "transform" + (new Random()).nextInt() + ".zip");
			dst.deleteOnExit();
			
			String surveyDefinitonName = "idml.xml";
			File definition = new File(tempFolder, surveyDefinitonName);
			
			ZipFile transformedCollectData = CollectEarthUtils.addFileToZip(dst.getAbsolutePath() , definition , surveyDefinitonName);
			
			
			
			addStepToZip(tempFolder, transformedCollectData, "1");
			addStepToZip(tempFolder, transformedCollectData, "2");
			addStepToZip(tempFolder, transformedCollectData, "3");
		} finally {
			FileUtils.deleteQuietly(tempFolder);
		}
		
		return dst;
	}

	
	private void addStepToZip(File tempFolder, ZipFile dstZipFile, String step)
			throws ZipException {
		File folderToZip = new File( tempFolder, "data"+ File.separator+step);
		CollectEarthUtils.addFolderToZip(dstZipFile, folderToZip);
	}

	private void forceRefreshGoogleEarth() {
		
		EarthApp.executeKmlLoadAsynchronously( null );
		
	}

	@Override
	public void update(Observable o, Object arg) {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				DataImportState importState = (DataImportState) o ;
				progressMonitor.setMessage( Messages.getString("ImportDialogProcessMonitor.2") ); //$NON-NLS-1$
				progressMonitor.updateProgress(  importState.getCount(), importState.getTotal());
			}	
		});
		
	}

}

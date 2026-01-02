package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.Arrays;

import javax.swing.JFrame;
import javax.swing.JOptionPane;

import org.apache.commons.io.IOUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.io.data.CSVDataImportProcess;
import org.openforis.collect.io.data.XMLDataImportProcess;
import org.openforis.collect.manager.process.ProcessStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class ImportActionListener implements ActionListener {
	protected static final Integer YES = 0;
	protected static final Integer YES_TO_ALL = 1;
	protected static final Integer NO = 2;
	protected static final Integer NO_TO_ALL = 3;

	private final DataFormat importFormat;
	private JFrame frame;
	private LocalPropertiesService localPropertiesService;
	private DataImportExportService dataImportService;
	private Logger logger = LoggerFactory.getLogger(ImportActionListener.class);

	public ImportActionListener(DataFormat importFormat, JFrame frame, LocalPropertiesService localPropertiesService,
			DataImportExportService dataImportService) {
		this.importFormat = importFormat;
		this.frame = frame;
		this.localPropertiesService = localPropertiesService;
		this.dataImportService = dataImportService;
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		try {
			CollectEarthWindow.startWaiting(frame);
			importDataFrom(e, importFormat);
		} finally {
			CollectEarthWindow.endWaiting(frame);
		}

	}

	private void forceRefreshGoogleEarth() {

		EarthApp.executeKmlLoadAsynchronously(null);

	}

	private Integer shouldImportNonFinishedRecords(boolean moreThanOneFiles) {
		String message = "<html>" //$NON-NLS-1$
				+ Messages.getString("ImportActionListener.0") //$NON-NLS-1$
				+ "<br/>" //$NON-NLS-1$
				+ Messages.getString("ImportActionListener.2") //$NON-NLS-1$
				+ "</html>";

		final String IMPORT_ALL = Messages.getString("ImportActionListener.10");
		final String IMPORT_ONLY_GREEN = Messages.getString("ImportActionListener.11");

		if (!moreThanOneFiles) {

			String[] buttons = { IMPORT_ALL, IMPORT_ONLY_GREEN };

			final int selectedOption = JOptionPane.showOptionDialog(null, message // $NON-NLS-1$
					, Messages.getString("ImportActionListener.3"), //$NON-NLS-1$
					JOptionPane.WARNING_MESSAGE, 0, null, buttons, buttons[1]);

			if (selectedOption == 0) {
				return YES;
			} else if (selectedOption == 1) {
				return NO;
			} else {
				return JOptionPane.CLOSED_OPTION;
			}
		} else {

			final String THIS_FILE = Messages.getString("ImportActionListener.thisFile");
			final String ALL_FILES = Messages.getString("ImportActionListener.allFiles");

			String[] buttons = { IMPORT_ALL + " - " + THIS_FILE, IMPORT_ALL + " - " + ALL_FILES,
					IMPORT_ONLY_GREEN + " - " + THIS_FILE, IMPORT_ONLY_GREEN + " - " + ALL_FILES };

			return JOptionPane.showOptionDialog(null, message, Messages.getString("ImportActionListener.3"),
					JOptionPane.WARNING_MESSAGE, 0, null, buttons, buttons[1]);

		}
	}

	private void importDataFrom(final ActionEvent e, final DataFormat importType) {
		File[] filesToImport = FileChooserUtils.getFileChooserResults(importType, false, true, null,
				localPropertiesService, frame);
		final ImportXMLDialogProcessMonitor importDialogProcessMonitor = new ImportXMLDialogProcessMonitor();
		if (filesToImport != null) {

			switch (importType) {
			case ZIP_WITH_XML:
				new Thread("XML Import Thread ") { //$NON-NLS-1$
					@Override
					public void run() {
						Integer importNonFinishedPlots = shouldImportNonFinishedRecords(filesToImport.length > 1);
						boolean firstFile = true;

						for (final File importedFile : filesToImport) {
							XMLDataImportProcess dataImportProcess = null;
							try {
								if (firstFile) {
									firstFile = false;
								} else if (!firstFile
										&& (importNonFinishedPlots.equals(YES) || importNonFinishedPlots.equals(NO))) {
									importNonFinishedPlots = shouldImportNonFinishedRecords(filesToImport.length > 1);
								}

								if (importNonFinishedPlots.equals(JOptionPane.CLOSED_OPTION)) {
									break;
								}

								boolean importNotFinished = importNonFinishedPlots.equals(YES)
										|| importNonFinishedPlots.equals(YES_TO_ALL);

								dataImportProcess = dataImportService.getImportSummary(importedFile, importNotFinished);
								importDialogProcessMonitor.startImport(dataImportProcess, frame, dataImportService,
										importedFile);

							} catch (Exception e1) {
								logger.error("Error importing data", e1); //$NON-NLS-1$
								importDialogProcessMonitor.closeProgressmonitor();
								JOptionPane.showMessageDialog(frame,
										importedFile.getName() + " - " + Messages.getString("CollectEarthWindow.3"), //$NON-NLS-1$ //$NON-NLS-2$
										importedFile.getName() + " - " + Messages.getString("CollectEarthWindow.7"), //$NON-NLS-1$ //$NON-NLS-2$
										JOptionPane.ERROR_MESSAGE);
								logger.error("Error importing data from " + importedFile.getAbsolutePath() //$NON-NLS-1$
										+ " in format " + importType.name(), e1); //$NON-NLS-1$
							} finally {
								IOUtils.closeQuietly(dataImportProcess);
							}
						}

						if (!importNonFinishedPlots.equals(JOptionPane.CLOSED_OPTION)) {
							forceRefreshGoogleEarth();
						}
					}
				}.start();
				break;
			case CSV:
				new Thread("Update using CSV Thread ") { //$NON-NLS-1$
					@Override
					public void run() {

						String[] ids = dataImportService.getEarthSurveyService().getKeyNamesForSurvey();
						String keyAttributesForSurvey = Arrays.toString(ids);

						JOptionPane.showMessageDialog(frame,
								"The CSV files used must have columns with at least the headers for the key attributes " //$NON-NLS-1$
										+ keyAttributesForSurvey
										+ " followed by one or more attribute names ( see https://www.openforis.support/questions/80/changing-plot-attributes-in-the-collect-earth-database ) ", //$NON-NLS-1$ //$NON-NLS-3$
																																																	// //$NON-NLS-4$
								"CSV file format info", JOptionPane.INFORMATION_MESSAGE);

						for (final File importedFile : filesToImport) {

							CSVDataImportProcess importSurveyAsCsv = null;
							try {
								importSurveyAsCsv = dataImportService.getCsvImporterProcess(importedFile);

								if (importSurveyAsCsv != null) {
									importSurveyAsCsv.init();
									ProcessStatus status = importSurveyAsCsv.getStatus();
									status.setTotal(getTotalNumberOfLines(importedFile));
									if (status != null && !importSurveyAsCsv.getStatus().isError()) {
										ImportProcessMonitorDialog importProcessWorker = new ImportProcessMonitorDialog(
												importSurveyAsCsv, frame);
										importProcessWorker.start();
									}
								}
							} catch (Exception e1) {
								JOptionPane.showMessageDialog(frame,
										Messages.getString("CollectEarthWindow.7") + "\n" + e1.getMessage(), //$NON-NLS-1$ //$NON-NLS-2$
										importedFile.getName() + " - " + Messages.getString("CollectEarthWindow.3"), //$NON-NLS-1$ //$NON-NLS-2$
										JOptionPane.ERROR_MESSAGE);
								logger.error("Error importing data from " + importedFile.getAbsolutePath() //$NON-NLS-1$
										+ " in format " + importType, e1); //$NON-NLS-1$
							}
						}
					}
				}.start();
				break;
			case FUSION:
				break;
			default:
				break;
			}
		}
	}

	private long getTotalNumberOfLines(File importedFile) {
		long count = 0;
		try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(importedFile)))) {
			while (br.readLine() != null) {
				count++;
			}
		} catch (IOException e) {
			logger.error("Error counting the number of lines in file " + importedFile.getAbsolutePath(), e);
		}
		return count;
	}
}

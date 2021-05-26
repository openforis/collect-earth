package org.openforis.collect.earth.app.view;

import java.awt.Color;
import java.awt.Dimension;
import java.awt.Frame;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JEditorPane;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.SwingUtilities;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.view.JFilePicker.DlgMode;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.persistence.RecordPersistenceException;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

import com.opencsv.CSVReader;

@Component
@Lazy
public class RemovePlotsFromDBDlg {

	@Autowired
	private RecordManager recordManager;

	@Autowired
	private EarthSurveyService earthSurveyService;

	@SuppressWarnings("unused")
	private static final long serialVersionUID = 5175096170385736616L;
	private CollectSurvey survey;
	private Logger logger = LoggerFactory.getLogger(RemovePlotsFromDBDlg.class);

	private JButton deleteFromDB;
	private JFilePicker filePicker;

	private JDialog dlg;

	public RemovePlotsFromDBDlg() {
		super();
	}

	private class DeleteResults {
		private boolean success;
		private Integer plotsDeleted;
		private Integer plotsNotFoundInDB;
		private Integer plotsErrorWhenDeleting;
		private List<String> messages;

		public DeleteResults(boolean success, Integer plotsDeleted, Integer plotsNotFoundInDB,
				Integer plotsErrorWhenDeleting, List<String> messages) {
			super();
			this.success = success;
			this.plotsDeleted = plotsDeleted;
			this.plotsNotFoundInDB = plotsNotFoundInDB;
			this.plotsErrorWhenDeleting = plotsErrorWhenDeleting;
			this.messages = messages;
		}

	}

	public void open(Frame owner, CollectSurvey survey) {
		this.dlg = new JDialog(owner);
		this.survey = survey;
		this.dlg.setModal(true);
		this.dlg.setSize(new Dimension(700, 350));
		this.dlg.setLocationRelativeTo(owner);
		this.dlg.setTitle("Tool for removing plots from DB using a CSV with plot IDs");
		initLayout();
		dlg.setVisible(true);
	}

	private void initLayout() {
		final JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints c = new GridBagConstraints();

		int row = 0;
		c.fill = GridBagConstraints.BOTH;

		c.gridx = 0;
		c.gridwidth = 2;
		panel.add(new JLabel("<html>"
				+ "This utility deletes plots that are already collected and present in the Collect Earth Database. <br/>"
				+ "<b>Make sure to backup the data in your DB before attempting to delete plots ( use the <i>Tools->Data Import/Export->Export data to Collect Backup</i> function).<b>"
				+ "<br/>"
				+ "The next field expects a CSV file for which the IDs of the plots to be deleted are present.The headers of the columns should be the names of the key attributes of the survey (usually just one, called ID, but it could be more)."
				+ "</html>"), c);
		c.gridy = row++;

		c.gridx = 0;
		c.gridwidth = 2;
		c.gridy = row++;
		panel.add(getCsvFilePicker(), c);
		c.gridy = row;

		panel.add(getDeleteButton(), c);
		this.dlg.add(panel);
	}

	private JButton getDeleteButton() {
		if (deleteFromDB == null) {
			deleteFromDB = new JButton("Delete plots with IDs in the CSV from the database");
			deleteFromDB.setEnabled(false);
			deleteFromDB.addActionListener( e -> {
				if (JOptionPane.showConfirmDialog(RemovePlotsFromDBDlg.this.dlg,
						"Are you sure you want to remove the plots with the IDs that are specified in the CSV file??",
						"Confirm deletion of plots in DB", JOptionPane.YES_NO_OPTION,
						JOptionPane.QUESTION_MESSAGE) == JOptionPane.YES_OPTION) {
					deletePlotsFromDB();
				}
			});
		}
		return deleteFromDB;
	}

	private boolean validateCsv(String filePath) {
		boolean validFile = true;

		try ( CSVReader csvReader = CsvReaderUtils.getCsvReader(filePath, false) ){

			filePicker.setTextBackground(Color.white);

			if (CsvReaderUtils.isCsvFile(filePath)) {

				// Get the first line
				String[] csvHeaders = csvReader.readNext();
				String[] expectedHeaders = getKeyAttributesName();
				if (!Arrays.equals(expectedHeaders, csvHeaders)) {
					JOptionPane.showMessageDialog(RemovePlotsFromDBDlg.this.dlg,
							String.format("The Headers of the CSV file used should be %s, instead they are %s",
									Arrays.toString(expectedHeaders),
									StringUtils.abbreviate(Arrays.toString(csvHeaders), 35)));
					filePicker.setTextBackground(Color.red);
					validFile = false;
				}

			} else {

				JOptionPane.showMessageDialog(RemovePlotsFromDBDlg.this.dlg,
						String.format("The file in %s is NOT A CSV file ", filePath));
				validFile = false;
				filePicker.setTextBackground(Color.red);
			}
		} catch (Exception e) {
			JOptionPane.showMessageDialog(RemovePlotsFromDBDlg.this.dlg,
					String.format("Error opening file at %s.  %s ", filePath, e.getMessage()));
			logger.error("Error while validating the CSV file", e);
			validFile = false;
		}

		getDeleteButton().setEnabled(validFile);
		return validFile;
	}

	private void deletePlotsFromDB() {
		InfiniteProgressMonitor progressDeletion = new InfiniteProgressMonitor(this.dlg, "Deleting plots",
				"Wait while the plots are deleted from the database");

		Thread treadDeleting = new Thread("Deleting plots from Database") {
			int plotsDeleted = 0;
			int plotsNotFoundInDB = 0;
			int plotsCouldNotBeDeleted = 0;
			boolean success = true;
			ArrayList<String> messages = new ArrayList<>();

			@Override
			public void run() {
				try ( CSVReader csvReader = CsvReaderUtils.getCsvReader(getCsvFilePicker().getSelectedFilePath(), false) ){
					List<String[]> allLines = csvReader.readAll();
					int totalLines = allLines.size() - 1;
					boolean skipFirst = true;
					int plot = 0;
					progressDeletion.showLater();
					for (String[] csvRow : allLines) {

						if (skipFirst) {
							skipFirst = false;
							continue;
						}

						progressDeletion.updateProgress(++plot, totalLines);

						CollectRecord record = earthSurveyService.loadRecord(csvRow);
						if (record == null) {
							plotsNotFoundInDB++;
							messages.add(String.format(" Could not find plot with ID %s in the Database",
									Arrays.toString(csvRow)));
						} else {
							try {
								recordManager.delete(record.getId());
								messages.add(String.format("Deleted plot with ID %s ", Arrays.toString(csvRow)));
								plotsDeleted++;
							} catch (RecordPersistenceException e) {
								plotsCouldNotBeDeleted++;
								messages.add(String.format("Error when deleting plot with ID %s. Error Message: %s",
										Arrays.toString(csvRow), e.getMessage()));
								logger.error("Error deleting plot with ID " + Arrays.toString(csvRow));
								success = false;
							}
						}
					}

				} catch (Exception e) {
					JOptionPane.showMessageDialog(RemovePlotsFromDBDlg.this.dlg,
							"Error reading CSV file");
					logger.error("Error while validating the CSV file", e);
					success = false;
				} finally {

					if (progressDeletion != null) {
						progressDeletion.close();
					}

				}

				DeleteResults deleteResults = new DeleteResults(success, plotsDeleted, plotsNotFoundInDB,
						plotsCouldNotBeDeleted, messages);
				String result = "Plots Deleted : " + deleteResults.plotsDeleted + "<br/>" +
						"Plots Not Found :</br>" + deleteResults.plotsNotFoundInDB + "<br/>"
						+ "Plots that could not be deleted because a exception : " + deleteResults.plotsErrorWhenDeleting + "<br/>" +
						" Messages : <br/> " + StringUtils.join(deleteResults.messages, "<br/>");
				if( success ) {
					result = "<html>"
							+ "<b>Results of the deletion process:</b><br/>"
							+ result + "</html>";
				}else {
					result = "<html>"
							+ "<b>There was an error while deleting the plots. Review the Collect Earth Log file in the Help menu.</b></br>"
							+ result + "</html>";
				}


				JEditorPane web = new JEditorPane();
				web.setEditable(false);
				web.setContentType("text/html");
				web.setText(result);


				JScrollPane scrollPane = new JScrollPane(web);
				scrollPane.setPreferredSize( new Dimension( 450, 350 ));

				// Refresh contents of Google Earth!
				EarthApp.executeKmlLoadAsynchronously( null );

				SwingUtilities.invokeLater( () -> {
					if (deleteResults.success) {
						JOptionPane.showMessageDialog(RemovePlotsFromDBDlg.this.dlg, scrollPane, "Success deleting plots", JOptionPane.INFORMATION_MESSAGE);
					} else {

						JOptionPane.showMessageDialog(RemovePlotsFromDBDlg.this.dlg, scrollPane, "Error deleting plots", JOptionPane.WARNING_MESSAGE);
					}
				});
			}
		};

		treadDeleting.start();

	}

	private String[] getKeyAttributesName() {
		List<AttributeDefinition> keyAttributeDefinitions = survey.getSchema().getRootEntityDefinitions().get(0)
				.getKeyAttributeDefinitions();
		String[] keyAttributeNames = new String[keyAttributeDefinitions.size()];
		int i = 0;
		for (AttributeDefinition keyAttributeDefinition : keyAttributeDefinitions) {
			keyAttributeNames[i++] = keyAttributeDefinition.getName();
		}
		return keyAttributeNames;
	}

	private JFilePicker getCsvFilePicker() {
		if (filePicker == null) {
			filePicker = new JFilePicker("Choose the CSV file containing the IDs of the plots to remove", null,
					"Explore", DlgMode.MODE_OPEN);

			filePicker.getFileChooser().setAcceptAllFileFilterUsed(false);
			filePicker.addFileTypeFilter("csv", " CSV file with plot IDs", true);

			filePicker.addChangeListener(new DocumentListener() {

				@Override
				public void removeUpdate(DocumentEvent e) {
					// Do not react
				}

				@Override
				public void insertUpdate(DocumentEvent e) {
					validateCsv(filePicker.getTextField().getText());
				}

				@Override
				public void changedUpdate(DocumentEvent e) {
					validateCsv(filePicker.getTextField().getText());
				}
			});
		}
		return filePicker;
	}

}

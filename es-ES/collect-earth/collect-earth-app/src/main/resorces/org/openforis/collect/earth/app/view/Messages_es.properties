package org.openforis.collect.earth.app.view;

import java.awt.Color;
import java.awt.Dimension;
import java.awt.Frame;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.io.File;
import java.io.IOException;
import java.util.List;

import javax.swing.DefaultComboBoxModel;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JDialog;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.view.JFilePicker.DlgMode;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.utils.ProduceCsvFiles;
import org.openforis.collect.io.metadata.collectearth.CSVFileValidationResult;
import org.openforis.collect.io.metadata.collectearth.CSVFileValidationResult.ErrorType;
import org.openforis.collect.io.metadata.collectearth.CollectEarthGridTemplateGenerator;
import org.openforis.collect.manager.validation.SurveyValidator.ValidationParameters;
import org.openforis.collect.model.CollectSurvey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class FileDividerToolDlg extends JDialog{

	private static final long serialVersionUID = 2241706750062961024L;
	private static final int MAX_FILES = 500;
	private CollectSurvey survey;
	private transient Logger logger = LoggerFactory.getLogger( FileDividerToolDlg.class);
	private JComboBox<Integer> numberOfFiles ;
	private JCheckBox randomSelector;
	private JComboBox<CsvColumn> csvColumns;
	private JFilePicker outputFolder;
	private JButton generateGrids;
	private JFilePicker filePicker;

	public static void open( Frame owner, CollectSurvey survey){
		FileDividerToolDlg dlg = new FileDividerToolDlg(owner, survey);
		dlg.setVisible(true);
	}

	public FileDividerToolDlg( Frame owner,CollectSurvey survey ) {
		super(owner);
		this.survey = survey;
		this.setModal(true);
		this.setSize( new Dimension(700,  350));
		this.setLocationRelativeTo( owner );
		this.setTitle("Tool for dividing large CSV into smaller ones");
		initLayout();
	}

	private void initLayout() {
		final JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints c = new GridBagConstraints();

		int row = 0;

		c.fill = GridBagConstraints.BOTH;
		c.gridx = 0;
		c.gridwidth = 2;
		c.gridy = row++;

		panel.add( getCsvFilePicker(), c );
		c.gridwidth = 1;
		c.gridy = row++;

		c.gridx = 0;

		panel.add( new JLabel("Number of files to split the CSV into"), c );

		c.gridx = 1;
		panel.add( getNumberOfFilesSelector(), c );

		c.gridx = 0;
		c.gridy = row++;
		c.gridwidth = 2;
		panel.add( getRandomSelector(), c );

		c.gridy = row++;
		c.gridx = 0;
		c.gridwidth = 1;
		panel.add( new JLabel("Split files by strata (values of the column i.e : region )"), c );

		c.gridx = 1;
		panel.add( getColumnSelector(), c );

		c.gridx = 0;
		c.gridy = row++;
		c.gridwidth = 2;
		panel.add( getOutputFolder(), c );

		c.gridx = 0;
		c.gridy = row;

		panel.add( getGenerateButton(), c );

		this.add(panel);
	}

	private JButton getGenerateButton() {
		if( generateGrids == null ){
			generateGrids = new JButton("Divide file");
			generateGrids.setEnabled( false );
			generateGrids.addActionListener( e -> {
				String sourceCsvFile = getCsvFilePicker().getSelectedFilePath();
				String destinationFolder = getOutputFolder().getSelectedFilePath();
				boolean randomizeLines = getRandomSelector().isSelected();
				Integer randomizeUsingColumnValues = null;
				if(  ( (CsvColumn) getColumnSelector().getSelectedItem() )!=null ){
					randomizeUsingColumnValues = ( (CsvColumn) getColumnSelector().getSelectedItem() ).getPos();
				}
				Integer filesToDivideInto = getNumberOfFilesSelector().getSelectedIndex()+1;
				ProduceCsvFiles produceCsvFiles = new ProduceCsvFiles(survey, sourceCsvFile, destinationFolder, randomizeLines, randomizeUsingColumnValues, filesToDivideInto);
				File dest = produceCsvFiles.divideIntoFiles();

				try {
					CollectEarthUtils.openFolderInExplorer( dest.getAbsolutePath() );
				} catch (IOException e1) {
					logger.error(" Error opening the destination folder", e);
				}
			});
		}
		return generateGrids;
	}

	private JFilePicker getOutputFolder() {
		if( outputFolder == null ){
			outputFolder = new JFilePicker("Select the output folder" , null, "Select...", DlgMode.MODE_SAVE);
			outputFolder.getFileChooser().setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
			outputFolder.setEnabled(false);

			outputFolder.addChangeListener( new DocumentListener() {

				@Override
				public void removeUpdate(DocumentEvent e) {
					// No need to do anything
				}

				@Override
				public void insertUpdate(DocumentEvent e) {
					String outputFolderPath = outputFolder.getSelectedFilePath();
					File out = new File( outputFolderPath );
					getGenerateButton().setEnabled(out.exists() );
				}

				@Override
				public void changedUpdate(DocumentEvent e) {
					// No need to react to the update
				}
			});
		}
		return outputFolder;
	}


	private void enableOtherControls(boolean validFile) {
		getRandomSelector().setEnabled( true );
		getColumnSelector().setEnabled(validFile);
		getNumberOfFilesSelector().setEnabled(true);
		getOutputFolder().setEnabled(true);
		setColumns( validFile );
	}


	private void setColumns( boolean validFile){
		if( validFile ){
			CollectEarthGridTemplateGenerator cegtg = new CollectEarthGridTemplateGenerator();

			List<String> expectedHeaders = cegtg.getExpectedHeaders(survey);
			CsvColumn[] columns = new CsvColumn[ expectedHeaders.size()+1 ];
			CsvColumn column = new CsvColumn(null,"DO NOT STRATIFY");
			columns[0] = column;

			int i = 0;
			for (String header : expectedHeaders) {
				column = new CsvColumn(i++,"Use :" + header);
				columns[i] = column;
			}

			getColumnSelector().setModel( new DefaultComboBoxModel<CsvColumn>( columns ));
		}else{
			getColumnSelector().setModel( new DefaultComboBoxModel<CsvColumn>());
		}
	}


	private JComboBox<CsvColumn> getColumnSelector() {
		if( csvColumns == null ){
			csvColumns = new JComboBox<>();
			csvColumns.setEnabled(false);
		}
		return csvColumns;
	}

	private JCheckBox getRandomSelector() {
		if( randomSelector == null ){
			randomSelector = new JCheckBox("Randomize the order of the lines from the source CSV file" , false);
			randomSelector.setEnabled( false);
		}
		return randomSelector;
	}

	private JComboBox<Integer> getNumberOfFilesSelector() {
		if( numberOfFiles == null ){
			Integer[] items = new Integer[MAX_FILES];
			for (int i =1; i<= MAX_FILES; i++) {
				items[i-1] = Integer.valueOf(i);
			}
			numberOfFiles = new JComboBox<>(items);
			numberOfFiles.setEnabled( false );
		}
		return numberOfFiles;
	}

	private JFilePicker getCsvFilePicker() {
		if( filePicker == null ){
			filePicker = new JFilePicker("Choose the CSV file with the sampling design (plots)", null, "Explore", DlgMode.MODE_OPEN);

			filePicker.getFileChooser().setAcceptAllFileFilterUsed(false);
			filePicker.addFileTypeFilter("csv", " CSV file with plot (sampling design)", true);

			filePicker.addChangeListener( new DocumentListener() {

				@Override
				public void removeUpdate(DocumentEvent e) {
					// No need to validate
				}

				@Override
				public void insertUpdate(DocumentEvent e) {
					validateCsv( filePicker.getTextField().getText() );
				}

				private boolean validateCsv(String filePath) {
					boolean validFile = true;
					try {

						filePicker.setTextBackground( Color.white);

						if( CsvReaderUtils.isCsvFile( filePath )){
							CollectEarthGridTemplateGenerator cetg = new CollectEarthGridTemplateGenerator();

							File csvFile = new File( filePath );
							ValidationParameters validationParameters = new ValidationParameters();
							validationParameters.setValidateOnlyFirstLines(false);
							CSVFileValidationResult validationResults = cetg.validate(csvFile, survey, validationParameters );

							validFile = validationResults.isSuccessful();
							if(
									!validFile
									// If the message is that there are too many rows then we ignore the validation!
									&& (
											validationResults.getErrorType().equals( ErrorType.INVALID_NUMBER_OF_PLOTS_TOO_LARGE)
											||
											validationResults.getErrorType().equals( ErrorType.INVALID_NUMBER_OF_PLOTS_WARNING)
											)
									){
								validFile = true;

							}

							if( !validFile ){
								filePicker.setTextBackground( Color.yellow);
								switch (  validationResults.getErrorType() ) {
								case INVALID_FILE_TYPE:
									filePicker.setTextBackground( Color.red);
									JOptionPane.showMessageDialog( FileDividerToolDlg.this.getParent(), "The expected file type is CSV or CED ", "Expected File Type", JOptionPane.ERROR_MESSAGE);
									break;

								case INVALID_HEADERS:
									JOptionPane.showMessageDialog( FileDividerToolDlg.this.getParent(),  String.format("The expected columns in the CSV for the survey %s are %s", survey.getName(), validationResults.getExpectedHeaders() ) , "Columns in CSV do not match survey", JOptionPane.ERROR_MESSAGE);
									break;

								case INVALID_NUMBER_OF_COLUMNS:
									JOptionPane.showMessageDialog( FileDividerToolDlg.this.getParent(), String.format("The number of columns in the CSV file do not coincide with the expercted columns expected for the survey %s /n%s", survey.getName(), validationResults.getExpectedHeaders() ), "Expected File Type", JOptionPane.ERROR_MESSAGE);
									break;

								case INVALID_VALUES_IN_CSV:
									// IN THIS CASE THE CELL RENDERER TAKES CARE OF HIGHLIGHTING THE CELLS!!!
									JOptionPane.showMessageDialog( FileDividerToolDlg.this.getParent(), "The content of the CSV file is not correct!! The values on some cells are incorrect for the survey " + survey.getName() , "CSV content is not correct", JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
									break;

								default:
									break;
								}
							}

							enableOtherControls( validFile );

						}else{

							JOptionPane.showMessageDialog(FileDividerToolDlg.this, String.format("The file in %s is NOT A CSV file ", filePath) );
							filePicker.setTextBackground( Color.red);
						}
					} catch (Exception e) {
						JOptionPane.showMessageDialog(FileDividerToolDlg.this, String.format("The file in %s is NOT A CSV file ", filePath) );
						logger.error( "Error while validating the CSV file", e);
						validFile = false;
					}
					return validFile;
				}

				@Override
				public void changedUpdate(DocumentEvent e) {
					validateCsv( filePicker.getTextField().getText() );
				}
			});
		}
		return filePicker ;
	}

}

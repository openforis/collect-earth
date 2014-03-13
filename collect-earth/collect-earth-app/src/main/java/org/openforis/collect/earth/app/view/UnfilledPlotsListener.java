package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.ad_hoc.FixCoordinates;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;

public final class UnfilledPlotsListener implements ActionListener {

	private LocalPropertiesService localPropertiesService;

	private JFrame frame;
	
	private RecordManager recordManager;

	private EarthSurveyService earthSurveyService;

	private final Logger logger = LoggerFactory.getLogger(FixCoordinates.class);

	private boolean stopFix = false;
	
	
	public UnfilledPlotsListener(RecordManager recordManager, EarthSurveyService earthSurveyService, JFrame frame, LocalPropertiesService localPropertiesService ) {
		this.recordManager = recordManager;
		this.earthSurveyService = earthSurveyService;
		this.frame = frame;
		this.localPropertiesService = localPropertiesService;
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		
		try {
			CollectEarthWindow.startWaiting(frame);
			final File[] selectedPlotFiles = JFileChooserExistsAware.getFileChooserResults(DataFormat.COLLECT_COORDS, false, true, null,
					localPropertiesService, frame);
			final Map<String, List<String>> plotIdsByFile = getPlotIdsByFile(selectedPlotFiles);
			Map<String, List<String>> missingPlotIds = getMissingPlotIds(plotIdsByFile);

			String missingPlotsText = getTextMissingPlots( missingPlotIds );

			final JDialog dialog = new JDialog(frame, "Unfilled plots");
			dialog.setLocationRelativeTo(frame);
			dialog.setSize(new Dimension(300, 400));
			dialog.setModal(false);

			final BorderLayout layoutManager = new BorderLayout();

			final JPanel panel = new JPanel(layoutManager);

			dialog.add(panel);

			JTextArea disclaimerTextArea = new JTextArea( missingPlotsText );
			disclaimerTextArea.setEditable(false);
			disclaimerTextArea.setLineWrap(true);
			disclaimerTextArea.setWrapStyleWord(true);
			final JScrollPane scrollPane = new JScrollPane(disclaimerTextArea);
			panel.add(scrollPane, BorderLayout.CENTER);
			scrollPane.setPreferredSize(new Dimension(250, 250));

			final JButton close = new JButton(Messages.getString("CollectEarthWindow.5")); //$NON-NLS-1$
			close.addActionListener(new ActionListener() {

				@Override
				public void actionPerformed(ActionEvent e) {
					dialog.setVisible(false);
				}
			});
			panel.add(close, BorderLayout.SOUTH);
			
			dialog.setVisible(true);
		} catch (Exception e1) {
			logger.error("Error while getting information about unfilled plot IDs");
		} finally{
			CollectEarthWindow.endWaiting(frame);
		}
		

	}

	private String getTextMissingPlots(Map<String, List<String>> missingPlotIds) {
		String missingPlots = "";

		Set<String> files = missingPlotIds.keySet();
		for (String file : files) {

			missingPlots += "\n" + "From file : " + file + " : \n";
			List<String> plotIds = missingPlotIds.get(file);
			for (String plotId : plotIds) {
				missingPlots += plotId + ",";
			}
			missingPlots = missingPlots.substring(0, missingPlots.length() - 1 );
			
		}

		return missingPlots;

	}

	private CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		CSVReader reader;
		final BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), Charset.forName("UTF-8")));
		reader = new CSVReader(bufferedReader, ',');
		return reader;
	}

	private List<String> getIdsInFile(String plotCoordinateFile) {
		final List<String> plotIds = new ArrayList<String>();
		try {
			final CSVReader plotCsvReader = getCsvReader(plotCoordinateFile);
			String[] csvRow;
			while ((csvRow = plotCsvReader.readNext()) != null) {
				plotIds.add(csvRow[0]);
			}
		} catch (final FileNotFoundException e) {
			logger.error("Error reading coordinate file " + plotCoordinateFile, e);
		} catch (final IOException e) {
			logger.error("Error reading CSV line", e);
		}

		return plotIds;
	}

	private Map<String, List<String>> getMissingPlotIds(Map<String, List<String>> plotIdsByFile) {
		final Map<String, List<String>> missingPlotIdsByFile = new HashMap<String, List<String>>();

		final Set<String> plotFiles = plotIdsByFile.keySet();
		for (final String plotFile : plotFiles) {

			final List<String> plotIdsInFile = plotIdsByFile.get(plotFile);
			for (final String plotId : plotIdsInFile) {

				if (shouldStopFixing()) {
					break;
				}
				if (!isIdInDB(plotId)) {
					if (!missingPlotIdsByFile.containsKey(plotFile)) {
						missingPlotIdsByFile.put(plotFile, new ArrayList<String>());
					}

					missingPlotIdsByFile.get(plotFile).add(plotId);
				}
			}

		}

		return missingPlotIdsByFile;
	}

	private Map<String, List<String>> getPlotIdsByFile(File[] selectedPlotFiles) {
		final Map<String, List<String>> plotIdsByFile = new HashMap<String, List<String>>();

		for (final File file : selectedPlotFiles) {
			if (shouldStopFixing()) {
				break;
			}
			plotIdsByFile.put(file.getAbsolutePath(), getIdsInFile(file.getAbsolutePath()));
		}

		return plotIdsByFile;
	}

	private boolean isIdInDB(String plotId) {
		final List<CollectRecord> summaries = recordManager.loadSummaries(earthSurveyService.getCollectSurvey(), EarthConstants.ROOT_ENTITY_NAME,
				plotId);
		return (summaries != null && summaries.size() == 1);
	}

	private boolean shouldStopFixing() {
		return stopFix;
	}

	public void stopFixing() {
		stopFix = true;

	}
}

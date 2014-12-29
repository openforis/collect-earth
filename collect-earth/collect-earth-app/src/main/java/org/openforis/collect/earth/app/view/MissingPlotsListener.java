package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.Toolkit;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.StringSelection;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
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

import javax.swing.AbstractAction;
import javax.swing.Action;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPopupMenu;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.ad_hoc.FixCoordinates;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.idm.model.BooleanAttribute;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;

public final class MissingPlotsListener implements ActionListener {

	private LocalPropertiesService localPropertiesService;

	private JFrame frame;

	private RecordManager recordManager;

	private EarthSurveyService earthSurveyService;

	private final Logger logger = LoggerFactory.getLogger(FixCoordinates.class);

	private boolean stopFix = false;

	private JTextArea disclaimerTextArea;


	public MissingPlotsListener(RecordManager recordManager, EarthSurveyService earthSurveyService, JFrame frame, LocalPropertiesService localPropertiesService ) {
		this.recordManager = recordManager;
		this.earthSurveyService = earthSurveyService;
		this.frame = frame;
		this.localPropertiesService = localPropertiesService;
	}

	@Override
	public void actionPerformed(ActionEvent e) {

		try {
			CollectEarthWindow.startWaiting(frame);
			final JDialog dialog = findMissingPlots();

			dialog.setVisible(true);
		} catch (Exception e1) {
			logger.error(Messages.getString("MissingPlotsListener.0")); //$NON-NLS-1$
		} finally{
			CollectEarthWindow.endWaiting(frame);
		}


	}

	private JDialog findMissingPlots() {

		JOptionPane.showMessageDialog( frame,
				Messages.getString("MissingPlotsListener.3"),  //$NON-NLS-1$
				Messages.getString("MissingPlotsListener.4"),  //$NON-NLS-1$
				JOptionPane.INFORMATION_MESSAGE
				);

		final File[] selectedPlotFiles = JFileChooserExistsAware.getFileChooserResults(DataFormat.COLLECT_COORDS, false, true, null,
				localPropertiesService, frame);
		long start = System.currentTimeMillis();
		final Map<String, List<String>> plotIdsByFile = getPlotIdsByFile(selectedPlotFiles);
		System.out.println("Finised getting all IDs " + ( start - System.currentTimeMillis() ) ); //$NON-NLS-1$
		start = System.currentTimeMillis();

		Map<String, List<String>> missingPlotIds = getMissingPlotIds(plotIdsByFile);

		System.out.println("Finised getting missing IDs " + ( start - System.currentTimeMillis() ) ); //$NON-NLS-1$
		start = System.currentTimeMillis();

		String missingPlotsText = getTextMissingPlots( missingPlotIds );

		final JDialog dialog = new JDialog(frame, Messages.getString("MissingPlotsListener.1")); //$NON-NLS-1$
		dialog.setLocationRelativeTo(frame);
		dialog.setSize(new Dimension(300, 400));
		dialog.setModal(false);

		final BorderLayout layoutManager = new BorderLayout();

		final JPanel panel = new JPanel(layoutManager);

		dialog.add(panel);

		disclaimerTextArea = new JTextArea( missingPlotsText );
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

		disclaimerTextArea.addMouseListener( new MouseAdapter() {
			public void mousePressed(MouseEvent e)  {check(e);}
			public void mouseReleased(MouseEvent e) {check(e);}

			public void check(MouseEvent e) {
				if (e.isPopupTrigger()) { //if the event shows the menu
					getPopupMenu().show(disclaimerTextArea, e.getPoint().x, e.getPoint().y);
				}
			}
		});

		return dialog;
	}

	private JPopupMenu getPopupMenu(){
		Action copyAction = new AbstractAction(Messages.getString("MissingPlotsListener.2")) { //$NON-NLS-1$

			private static final long serialVersionUID = 1L;

			@Override
			public void actionPerformed(ActionEvent e) {
				disclaimerTextArea.selectAll();
				String selection =disclaimerTextArea.getSelectedText();
				Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
				if(selection==null){
					return;
				}
				StringSelection clipString=new StringSelection(selection);
				clipboard.setContents(clipString, clipString);
			}
		};

		JPopupMenu popup = new JPopupMenu();
		popup.add (copyAction);
		return popup;
	}

	private String getTextMissingPlots(Map<String, List<String>> missingPlotIds) {
		String missingPlots = ""; //$NON-NLS-1$

		Set<String> files = missingPlotIds.keySet();
		for (String file : files) {

			missingPlots += "\n" + Messages.getString("MissingPlotsListener.5") + file + " : \n"; //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			List<String> plotIds = missingPlotIds.get(file);
			if( plotIds.size() == 0 ){
				missingPlots += "COMPLETE "; //$NON-NLS-1$
			}
			
			for (String plotId : plotIds) {
				missingPlots += plotId + ","; //$NON-NLS-1$
			}
			
			missingPlots = missingPlots.substring(0, missingPlots.length() - 1 ) + "\n";

		}

		return missingPlots;

	}

	private CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		CSVReader reader;
		final BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), Charset.forName("UTF-8"))); //$NON-NLS-1$
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
			logger.error("Error reading coordinate file " + plotCoordinateFile, e); //$NON-NLS-1$
		} catch (final IOException e) {
			logger.error("Error reading CSV line", e); //$NON-NLS-1$
		}

		return plotIds;
	}

	private Map<String, List<String>> getMissingPlotIds(Map<String, List<String>> plotIdsByFile) {
		final Map<String, List<String>> missingPlotIdsByFile = new HashMap<String, List<String>>();

		final Set<String> plotFiles = plotIdsByFile.keySet();
		for (final String plotFile : plotFiles) {

			missingPlotIdsByFile.put(plotFile, new ArrayList<String>());
			
			final List<String> plotIdsInFile = plotIdsByFile.get(plotFile);
			for (final String plotId : plotIdsInFile) {

				if (shouldStopFixing()) {
					break;
				}
				if (!isIdActivelySavedInDB(plotId)) {
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

	private boolean isIdActivelySavedInDB(String plotId) {
		final List<CollectRecord> summaries = recordManager.loadSummaries(
				earthSurveyService.getCollectSurvey(), 
				EarthConstants.ROOT_ENTITY_NAME,
				plotId
			);

		if( summaries != null && summaries.size() == 1 ){
			CollectRecord record = recordManager.load(earthSurveyService.getCollectSurvey(), summaries.get(0).getId(), Step.ENTRY);
			BooleanAttribute node = null;
			try {
				node = (BooleanAttribute) record.findNodeByPath("/plot/actively_saved"); //$NON-NLS-1$
			} catch (Exception e) {
				logger.error("No actively_saved information found", e); //$NON-NLS-1$
			}
			return (node != null && !node.isEmpty() && node.getValue().getValue() );
		}else{
			return false;
		}
	}

	private boolean shouldStopFixing() {
		return stopFix;
	}

	public void stopFixing() {
		stopFix = true;

	}
}

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
import java.io.File;
import java.io.IOException;
import java.util.List;
import java.util.Map;

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
import javax.swing.SwingUtilities;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.ad_hoc.FixCoordinates;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.MissingPlotService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class MissingPlotsListener implements ActionListener {

	private LocalPropertiesService localPropertiesService;

	private JFrame frame;

	private final Logger logger = LoggerFactory.getLogger(FixCoordinates.class);

	private JTextArea disclaimerTextArea;

	private MissingPlotService missingPlotService;

	public MissingPlotsListener(JFrame frame, LocalPropertiesService localPropertiesService,
			MissingPlotService missingPlotService) {
		this.frame = frame;
		this.localPropertiesService = localPropertiesService;
		this.missingPlotService = missingPlotService;
	}

	@Override
	public void actionPerformed(ActionEvent e) {

		try {
			CollectEarthWindow.startWaiting(frame);
			findMissingPlots();
		} catch (Exception e1) {
			logger.error(Messages.getString("MissingPlotsListener.0"), e1); //$NON-NLS-1$
		} finally {

			CollectEarthWindow.endWaiting(frame);
		}

	}

	private void findMissingPlots() {

		showInfoAboutFunctionality();


		InfiniteProgressMonitor infiniteProgressMonitor = new InfiniteProgressMonitor(frame,
				"Finding missing plots", "Please wait...");

		try {
			String csvFile = localPropertiesService.getCsvFile();
			File currentFolder = null;

			if (!StringUtils.isBlank(csvFile)) {
				File file = new File(csvFile);
				if (file.exists())
					currentFolder = file.getParentFile();
			}

			final File[] selectedPlotFiles = JFileChooserExistsAware.getFileChooserResults(
					DataFormat.COLLECT_COORDS, false, true, null, localPropertiesService, frame, currentFolder);
			if( selectedPlotFiles != null && selectedPlotFiles.length > 0 ) {
				new Thread("Finding Missing plots") {
					@Override
					public void run() {
						infiniteProgressMonitor.showLater();

						// Returns the list of all of the plots that are stored in the selected CSV
						// files
						final Map<String, List<String[]>> allPlotsInFiles = missingPlotService
								.getPlotDataByFile(selectedPlotFiles);

						// Returns the list of the plots that are not completely saved or not saved at
						// all in the DB
						Map<String, List<String[]>> missingPlotData = missingPlotService
								.getMissingPlotsByFile(allPlotsInFiles, infiniteProgressMonitor);
						// Generates a text representation of the missing plots plus the brief on the
						// total plots
						String missingPlotsText = missingPlotService.getMissingPlotInformation(allPlotsInFiles, missingPlotData);
						// Generates a temporary file that contains the missing plots as a CED
						File tempFile = missingPlotService.getMissingPlotFile(missingPlotData);
						SwingUtilities.invokeLater(new Runnable() {
							@Override
							public void run() {
								infiniteProgressMonitor.close();
							}
						});

						JDialog missingDlg = buildDialog(missingPlotsText, tempFile);

						Runnable setVisible =() -> {missingDlg.setVisible(true);};
						SwingUtilities.invokeLater( setVisible );
					}
				}.start();
			}
		} catch (Exception e) {
			logger.error("Error while finding missing plots", e);
		} finally {
			infiniteProgressMonitor.close();
		}
	}

	private JDialog buildDialog(String missingPlotsText, File tempFile) {
		final JDialog dialog = new JDialog(frame, Messages.getString("MissingPlotsListener.1")); //$NON-NLS-1$
		dialog.setLocationRelativeTo(frame);
		dialog.setSize(new Dimension(300, 400));
		dialog.setModal(false);

		final BorderLayout layoutManager = new BorderLayout();

		final JPanel panel = new JPanel(layoutManager);

		dialog.add(panel);

		disclaimerTextArea = new JTextArea(missingPlotsText);
		disclaimerTextArea.setEditable(false);
		disclaimerTextArea.setLineWrap(true);
		disclaimerTextArea.setWrapStyleWord(true);
		final JScrollPane scrollPane = new JScrollPane(disclaimerTextArea);
		panel.add(scrollPane, BorderLayout.CENTER);
		scrollPane.setPreferredSize(new Dimension(250, 250));

		final JButton close = new JButton(Messages.getString("CollectEarthWindow.5")); //$NON-NLS-1$
		close.addActionListener(e -> dialog.setVisible(false));
		panel.add(close, BorderLayout.SOUTH);

		if (tempFile != null) {
			final JButton export = new JButton(Messages.getString(Messages.getString("MissingPlotsListener.6"))); //$NON-NLS-1$
			ActionListener exportListener = getSaveAsListener(tempFile);
			export.addActionListener(exportListener);
			panel.add(export, BorderLayout.SOUTH);
		}

		disclaimerTextArea.addMouseListener(new MouseAdapter() {
			@Override
			public void mousePressed(MouseEvent e) {
				check(e);
			}

			@Override
			public void mouseReleased(MouseEvent e) {
				check(e);
			}

			public void check(MouseEvent e) {
				if (e.isPopupTrigger()) { // if the event shows the menu
					getPopupMenu().show(disclaimerTextArea, e.getPoint().x, e.getPoint().y);
				}
			}
		});

		return dialog;
	}

	private ActionListener getSaveAsListener(File tempFile) {

		return new ActionListener() {

			@Override
			public void actionPerformed(ActionEvent e) {
				final File[] saveToCsvFile = JFileChooserExistsAware.getFileChooserResults(DataFormat.COLLECT_COORDS,
						true, false, "plotsWithMissingInfo.csv", //$NON-NLS-1$ //$NON-NLS-2$
						localPropertiesService, frame);

				if (saveToCsvFile != null && saveToCsvFile.length == 1) {
					try {
						FileUtils.copyFile(tempFile, saveToCsvFile[0]);
					} catch (IOException e1) {
						logger.error("Error when copying temporary file with missing plots to final destination " //$NON-NLS-1$
								+ tempFile.getAbsolutePath() + " to " + saveToCsvFile[0].getAbsolutePath(), e); //$NON-NLS-1$
					}

				}
			}
		};

	}

	public void showInfoAboutFunctionality() {
		JOptionPane.showMessageDialog(frame, Messages.getString("MissingPlotsListener.3"), //$NON-NLS-1$
				Messages.getString("MissingPlotsListener.4"), //$NON-NLS-1$
				JOptionPane.INFORMATION_MESSAGE);
	}

	private JPopupMenu getPopupMenu() {
		Action copyAction = new AbstractAction(Messages.getString("MissingPlotsListener.2")) { //$NON-NLS-1$

			private static final long serialVersionUID = 1L;

			@Override
			public void actionPerformed(ActionEvent e) {
				disclaimerTextArea.selectAll();
				String selection = disclaimerTextArea.getSelectedText();
				Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
				if (selection == null) {
					return;
				}
				StringSelection clipString = new StringSelection(selection);
				clipboard.setContents(clipString, clipString);
			}
		};

		JPopupMenu popup = new JPopupMenu();
		popup.add(copyAction);
		return popup;
	}

}

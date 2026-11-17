package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.Reader;
import java.io.StringWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.CloudApiException;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.Destination;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.MyPlotsFile;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.MyPlotsInfo;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.stereotype.Component;

import com.opencsv.CSVReader;
import com.opencsv.CSVReaderBuilder;
import com.opencsv.CSVWriter;
import com.opencsv.RFC4180ParserBuilder;
import com.opencsv.exceptions.CsvValidationException;

/**
 * The person's plots in a cloud project, kept up to date by Collect Earth (docs/plans/2026-11-16-plots-from-the-server.md,
 * stage 2). The server builds one plot file of every plot the person holds, whatever their role (GET my-plots); Collect
 * Earth keeps a copy of it in its data folder ({@code cloud/<project>/my-plots.csv}, not in the project folder, whose
 * checksum stays the project file's) and makes it the plots file, so every part of Collect Earth reads it as it reads a
 * project's own plot file. It asks the server at the join (before the restart), at each start and every five minutes
 * whether the person's plots changed, and when they did it replaces the copy, reloads the plots and says what changed.
 * <ul>
 * <li>A plot that is no longer the person's while it has changes here not sent yet stays in the copy until they are sent,
 * so nobody loses a plot half-way through.</li>
 * <li>Each row's plot file comes with it (the server's last column, taken off the copy): the record keeps it as it keeps
 * a project's own plot file's ({@link #plotFileOf}).</li>
 * <li>A training set the person opened (Settings › Project) stays the plots file until they go back to their plots;
 * training sets are not in the person's plots.</li>
 * <li>Offline, the last copy is used. An older server, which has no person's plots, keeps the assigned plot files of before
 * (AssignedPlotFileSetup).</li>
 * </ul>
 */
@Component
public class MyPlotsService implements ApplicationListener<ContextRefreshedEvent> {

	/** The notices' kind */
	public static final String NOTICE = "cloudMyPlots"; //$NON-NLS-1$
	/** How often the server is asked whether the person's plots changed */
	static final long CHECK_MINUTES = 5;
	/** For the real runs: another interval, in seconds */
	static final String CHECK_SECONDS_PROPERTY = "collectearth.myPlotsCheckSeconds"; //$NON-NLS-1$

	static final String COPY = "my-plots.csv"; //$NON-NLS-1$
	static final String SERVER_COPY = "server-plots.csv"; //$NON-NLS-1$
	static final String SERVER_PLOT_FILES = "server-plot-files.csv"; //$NON-NLS-1$
	static final String PLOT_FILES = "plot-files.csv"; //$NON-NLS-1$
	static final String STATE = "my-plots.properties"; //$NON-NLS-1$

	/** What a check did */
	public enum Outcome {
		/** Not in a cloud project, or signed out */
		NOT_CLOUD,
		/** The copy or the plots file changed: the plots were reloaded */
		UPDATED,
		/** Nothing changed */
		UNCHANGED,
		/** The server did not answer: the last copy is used */
		OFFLINE,
		/** The server has no person's plots (an older one): the assigned plot files of before apply */
		OLDER_SERVER,
		/** The server says the person is not in the project (any more): nothing is changed */
		NOT_MEMBER,
		/** Something went wrong here (logged): tried again at the next check */
		FAILED
	}

	private final Logger logger = LoggerFactory.getLogger(MyPlotsService.class);

	private final LocalPropertiesService properties;
	private final CloudApiClient api;
	private final NoticeService notices;
	private final Runnable reload;
	/** {@code <data folder>/cloud} */
	private final File root;

	/** Whether a plot has changes here not sent yet (absent in some tests) */
	private CloudSyncService sync;
	/** The server was found to have no person's plots this run: not asked again until the next start */
	private volatile boolean olderServer;
	private volatile boolean started;
	/** Each row's plot file of the copy, read when it changed */
	/**
	 * Guards the plot file of each plot read for the form ({@link #plotFileOf}), apart from the service's lock: a check
	 * holds that one through its calls to the server, and the form of a plot would wait for them.
	 */
	private final Object plotFilesLock = new Object();
	/** Guards the plots file setting with the training set's, written together ({@link #usePlotFile}, {@link #openTraining}) */
	private final Object plotFileSetting = new Object();
	private Map<String, String> plotFiles = Collections.emptyMap();
	private String plotFilesStamp = ""; //$NON-NLS-1$

	@Autowired
	public MyPlotsService(LocalPropertiesService properties, CloudApiClient api, @Autowired(required = false) NoticeService notices) {
		this(properties, api, notices, EarthApp::reloadPlots, new File(FolderFinder.getCollectEarthDataFolder(), "cloud")); //$NON-NLS-1$
	}

	/** For the tests: the reload stood in for, the folder chosen */
	MyPlotsService(LocalPropertiesService properties, CloudApiClient api, NoticeService notices, Runnable reload, File root) {
		this.properties = properties;
		this.api = api;
		this.notices = notices;
		this.reload = reload;
		this.root = root;
	}

	@Autowired(required = false)
	public void setSync(CloudSyncService sync) {
		this.sync = sync;
	}

	/** The checks every five minutes, once a start, in a cloud project (the start's own is {@link #atStart}) */
	@Override
	public void onApplicationEvent(ContextRefreshedEvent event) {
		if (!properties.isCloudSyncEnabled() || started) {
			return;
		}
		started = true;
		long seconds = Math.max(10, Long.getLong(CHECK_SECONDS_PROPERTY, CHECK_MINUTES * 60));
		ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(r -> {
			Thread t = new Thread(r, "CollectEarth-my-plots"); //$NON-NLS-1$
			t.setDaemon(true);
			return t;
		});
		executor.scheduleWithFixedDelay(() -> {
			if (!olderServer) {
				check();
			}
		}, seconds, seconds, TimeUnit.SECONDS);
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Where the copy is

	/** The folder of a cloud project's copy */
	File folderOf(String projectId) {
		return new File(root, StringUtils.defaultString(projectId).replaceAll("[^A-Za-z0-9._-]", "_")); //$NON-NLS-1$ //$NON-NLS-2$
	}

	/** The copy Collect Earth reads in the open cloud project */
	public File copy() {
		return new File(folderOf(properties.getCloudProjectId()), COPY);
	}

	/** Whether a plots file is the person's plots of a cloud project (the copy of one) */
	public boolean isCopy(String path) {
		return isCopyIn(path, root);
	}

	/** Whether a plots file is the person's plots of a cloud project, in Collect Earth's data folder (the settings' check) */
	public static boolean isPersonsPlots(String path) {
		return isCopyIn(path, new File(FolderFinder.getCollectEarthDataFolder(), "cloud")); //$NON-NLS-1$
	}

	private static boolean isCopyIn(String path, File root) {
		if (StringUtils.isBlank(path)) {
			return false;
		}
		File file = new File(path.trim()).getAbsoluteFile();
		return COPY.equals(file.getName()) && file.getParentFile() != null && root.getAbsoluteFile().equals(file.getParentFile().getParentFile());
	}

	private String plotFileInUse() {
		return StringUtils.trimToEmpty(properties.getValue(EarthProperty.SAMPLE_FILE));
	}

	/** The person opened a training set: the plots file stays on it */
	boolean onTraining() {
		String training = StringUtils.trimToEmpty(properties.getValue(EarthProperty.CLOUD_TRAINING_FILE));
		return !training.isEmpty() && sameFile(training, plotFileInUse()) && new File(training).isFile();
	}

	private static boolean sameFile(String a, String b) {
		return !a.isEmpty() && !b.isEmpty() && new File(a).getAbsoluteFile().equals(new File(b).getAbsoluteFile());
	}

	// ---------------------------------------------------------------------------------------------------------------
	// The checks

	/** At a start, once the plots are loaded: never throws */
	public Outcome atStart() {
		return check();
	}

	/** Asks the server now ("Refresh now", the checks): never throws */
	public synchronized Outcome check() {
		try {
			if (!properties.isCloudSyncEnabled() || StringUtils.isBlank(properties.getCloudSyncToken())) {
				return Outcome.NOT_CLOUD;
			}
			Destination destination = api.cloudDestination();
			Outcome outcome = update(destination);
			if (outcome == Outcome.OLDER_SERVER) {
				olderServer = true;
				return outcome;
			}
			if (outcome == Outcome.NOT_MEMBER) {
				return outcome;
			}
			// Offline too: the last copy (with the plots whose changes are not sent yet)
			boolean changed = compose(destination.getProjectId(), outcome == Outcome.UPDATED);
			boolean switched = usePlotFile(false);
			if (changed || switched) {
				reload.run();
				return Outcome.UPDATED;
			}
			return outcome == Outcome.UPDATED ? Outcome.UNCHANGED : outcome;
		} catch (IOException | RuntimeException e) {
			logger.warn("The person's plots could not be brought up to date: {}", e.getMessage()); //$NON-NLS-1$
			return Outcome.FAILED;
		}
	}

	/**
	 * At the join, before the restart: the person's plots downloaded and made the plots file, so the first start shows
	 * them. False when the server has none (an older one) or could not be asked: the next start tries again.
	 */
	public synchronized boolean atJoin(Destination destination) {
		try {
			Outcome outcome = update(destination);
			if (outcome != Outcome.UPDATED && outcome != Outcome.UNCHANGED) {
				return false;
			}
			compose(destination.getProjectId(), false);
			properties.setValue(EarthProperty.SAMPLE_FILE, new File(folderOf(destination.getProjectId()), COPY).getAbsolutePath());
			properties.setValue(EarthProperty.CLOUD_TRAINING_FILE, ""); //$NON-NLS-1$
			return true;
		} catch (IOException | RuntimeException e) {
			logger.warn("The person's plots could not be downloaded at the join: {}", e.getMessage()); //$NON-NLS-1$
			return false;
		}
	}

	/** Back to the person's plots from a training set (Settings › Project): the plots are reloaded */
	public synchronized boolean useMyPlots() {
		properties.setValue(EarthProperty.CLOUD_TRAINING_FILE, ""); //$NON-NLS-1$
		if (usePlotFile(true)) {
			reload.run();
			return true;
		}
		return false;
	}

	/**
	 * Asks the server and, when the person's plots changed, downloads them (the server's copy and each row's plot file).
	 * UPDATED when downloaded, UNCHANGED when the copy is the server's version.
	 */
	private Outcome update(Destination destination) throws IOException {
		File folder = folderOf(destination.getProjectId());
		Properties state = readState(folder);
		for (int attempt = 0; attempt < 2; attempt++) {
			MyPlotsInfo info;
			try {
				info = api.myPlots(destination);
			} catch (CloudApiException e) {
				if (e.getStatus() == 404) {
					return olderServerOrNotMember();
				}
				return e.getStatus() == 401 || e.getStatus() == 403 ? Outcome.NOT_MEMBER : Outcome.OFFLINE;
			} catch (IOException e) {
				return Outcome.OFFLINE;
			}
			state.setProperty("checkedAt", String.valueOf(System.currentTimeMillis())); //$NON-NLS-1$
			state.setProperty("keyColumns", String.valueOf(info.getKeyColumns())); //$NON-NLS-1$
			state.setProperty("leftOut", String.join("\n", info.getLeftOut())); //$NON-NLS-1$ //$NON-NLS-2$
			state.setProperty("unreadable", String.valueOf(info.getUnreadable())); //$NON-NLS-1$
			if (info.getVersion().equals(state.getProperty("version")) && new File(folder, SERVER_COPY).isFile()) { //$NON-NLS-1$
				writeState(folder, state);
				return Outcome.UNCHANGED;
			}
			MyPlotsFile file;
			try {
				file = api.downloadMyPlots(destination, info.getDownloadPath());
			} catch (CloudApiException e) {
				if (e.getStatus() == 409 && attempt == 0) {
					continue; // changed since it was listed: asked again
				}
				return Outcome.OFFLINE;
			} catch (IOException e) {
				return Outcome.OFFLINE;
			}
			try {
				split(file, folder, info.getKeyColumns());
			} finally {
				Files.deleteIfExists(file.getFile().toPath());
			}
			state.setProperty("version", info.getVersion()); //$NON-NLS-1$
			state.setProperty("updatedAt", String.valueOf(System.currentTimeMillis())); //$NON-NLS-1$
			writeState(folder, state);
			logger.info("The person's plots were downloaded: {} plots", info.getPlots()); //$NON-NLS-1$
			return Outcome.UPDATED;
		}
		return Outcome.OFFLINE;
	}

	/** my-plots answered 404: an older server still lists the assigned plot files; else the person is not in the project */
	private Outcome olderServerOrNotMember() {
		try {
			api.getMyAssignments();
			return Outcome.OLDER_SERVER;
		} catch (CloudApiException e) {
			return e.getStatus() == 404 || e.getStatus() == 401 || e.getStatus() == 403 ? Outcome.NOT_MEMBER : Outcome.OFFLINE;
		} catch (IOException e) {
			return Outcome.OFFLINE;
		}
	}

	/**
	 * Makes the copy the plots file, unless a training set is open (or {@code always}, going back from one). True when
	 * the plots file changed.
	 */
	private boolean usePlotFile(boolean always) {
		synchronized (plotFileSetting) {
			File copy = copy();
			if (!copy.isFile() || sameFile(copy.getAbsolutePath(), plotFileInUse()) || !always && onTraining()) {
				return false;
			}
			properties.setValue(EarthProperty.SAMPLE_FILE, copy.getAbsolutePath());
			properties.setValue(EarthProperty.CLOUD_TRAINING_FILE, ""); //$NON-NLS-1$
			return true;
		}
	}

	/**
	 * Makes a training set the plots file. Both settings are written together, so a check running meanwhile sees either
	 * the person's plots or the training set open, never the training set as the plots file but not as open (it would put
	 * the person's plots back). Not under the service's lock: a check may be waiting for the server.
	 */
	public void openTraining(File training) {
		synchronized (plotFileSetting) {
			properties.setValue(EarthProperty.SAMPLE_FILE, training.getAbsolutePath());
			properties.setValue(EarthProperty.CLOUD_TRAINING_FILE, training.getAbsolutePath());
		}
	}

	// ---------------------------------------------------------------------------------------------------------------
	// The files

	/** The server's file split: its rows (without the plot file column) and each row's plot file */
	private void split(MyPlotsFile file, File folder, int keyColumns) throws IOException {
		List<String[]> rows = read(file.getFile());
		List<String[]> plots = new ArrayList<>(rows.size());
		List<String[]> files = new ArrayList<>(rows.size());
		for (String[] row : rows) {
			if (file.hasPlotFileColumn() && row.length > 0) {
				String[] plot = Arrays.copyOf(row, row.length - 1);
				plots.add(plot);
				files.add(new String[] { keyOf(plot, keyColumns), row[row.length - 1] });
			} else {
				plots.add(row);
			}
		}
		if (!folder.isDirectory() && !folder.mkdirs()) {
			throw new IOException("Could not make the folder of the person's plots " + folder); //$NON-NLS-1$
		}
		writeIfChanged(new File(folder, SERVER_COPY), plots);
		writeIfChanged(new File(folder, SERVER_PLOT_FILES), files);
	}

	/**
	 * The copy: the server's rows, then the rows of the copy of before whose plots are no longer the person's while their
	 * changes here are not sent yet (with the same columns). Always a header row when the server's file had none to give
	 * (the person holds nothing): the plot readers refuse an empty file. True when it changed; says what changed.
	 */
	private boolean compose(String projectId, boolean downloaded) throws IOException {
		File folder = folderOf(projectId);
		File serverCopy = new File(folder, SERVER_COPY);
		if (!serverCopy.isFile()) {
			return false;
		}
		int keyColumns = Math.max(1, Integer.parseInt(readState(folder).getProperty("keyColumns", "1"))); //$NON-NLS-1$ //$NON-NLS-2$
		File copyFile = new File(folder, COPY);
		List<String[]> server = read(serverCopy);
		List<String[]> before = copyFile.isFile() ? read(copyFile) : Collections.emptyList();
		String[] header = !server.isEmpty() && isHeader(server.get(0)) ? server.get(0) : null;
		String[] headerBefore = !before.isEmpty() && isHeader(before.get(0)) ? before.get(0) : null;

		List<String[]> rows = new ArrayList<>(server);
		if (rows.isEmpty()) {
			String[] fallback = headerBefore != null ? headerBefore : projectFileHeader();
			if (fallback != null) {
				rows.add(fallback);
				header = fallback;
			}
		}
		Set<String> keys = keysOf(rows, header != null, keyColumns);
		Set<String> keysBefore = keysOf(before, headerBefore != null, keyColumns);
		// Kept until sent: the plots that left, with work not sent yet, when the columns are the same
		Map<String, String> filesBefore = readPlotFiles(new File(folder, PLOT_FILES));
		Map<String, String> files = readPlotFiles(new File(folder, SERVER_PLOT_FILES));
		int kept = 0;
		if (Arrays.equals(header, headerBefore)) {
			for (int i = headerBefore != null ? 1 : 0; i < before.size(); i++) {
				String key = keyOf(before.get(i), keyColumns);
				if (!keys.contains(key) && unsentHere(key)) {
					rows.add(before.get(i));
					if (filesBefore.containsKey(key)) {
						files.put(key, filesBefore.get(key));
					}
					kept++;
				}
			}
		}
		List<String[]> fileRows = new ArrayList<>(files.size());
		for (Map.Entry<String, String> e : files.entrySet()) {
			fileRows.add(new String[] { e.getKey(), e.getValue() });
		}
		// The plots first: if their file cannot be replaced now, the plot files stay those of the plots in it
		boolean changed = writeIfChanged(copyFile, rows);
		writeIfChanged(new File(folder, PLOT_FILES), fileRows);
		if (changed) {
			Set<String> now = keysOf(rows, header != null, keyColumns);
			say(before.isEmpty(), now, keysBefore, kept);
		} else if (downloaded) {
			logger.debug("The person's plots were downloaded and are the same as the copy"); //$NON-NLS-1$
		}
		return changed;
	}

	/** The notice of a change of the person's plots */
	private void say(boolean first, Set<String> now, Set<String> before, int kept) {
		if (notices == null) {
			return;
		}
		String message;
		if (first) {
			message = MessageFormat.format(Messages.getString("MyPlots.first"), now.size()); //$NON-NLS-1$
		} else {
			int added = 0;
			for (String key : now) {
				if (!before.contains(key)) {
					added++;
				}
			}
			int removed = 0;
			for (String key : before) {
				if (!now.contains(key)) {
					removed++;
				}
			}
			if (added == 0 && removed == 0) {
				return; // the same plots, another column's value
			}
			message = MessageFormat.format(Messages.getString("MyPlots.changed"), added, removed, now.size()); //$NON-NLS-1$
			if (kept > 0) {
				message += " " + MessageFormat.format(Messages.getString("MyPlots.kept"), kept); //$NON-NLS-1$ //$NON-NLS-2$
			}
		}
		notices.post(new Notice(NOTICE, Notice.INFO, Messages.getString("MyPlots.title"), message)); //$NON-NLS-1$
	}

	/** The header row of the project file's own plot file (the person holds no plot), or null */
	private String[] projectFileHeader() {
		try {
			File folder = new File(StringUtils.defaultString(properties.getProjectFolder()));
			File definition = new File(folder, "project_definition.properties"); //$NON-NLS-1$
			if (!definition.isFile()) {
				return null;
			}
			Properties project = new Properties();
			try (Reader reader = Files.newBufferedReader(definition.toPath(), StandardCharsets.UTF_8)) {
				project.load(reader);
			}
			String csv = StringUtils.trimToNull(project.getProperty(EarthProperty.SAMPLE_FILE.toString()));
			if (csv == null) {
				return null;
			}
			File plots = new File(csv.replace("${project_path}", folder.getAbsolutePath())); //$NON-NLS-1$
			if (!plots.isFile()) {
				return null;
			}
			try (CSVReader reader = org.openforis.collect.earth.core.utils.CsvReaderUtils.getCsvReader(plots.getAbsolutePath())) {
				String[] first = reader.readNext();
				return first != null && isHeader(first) ? first : null;
			}
		} catch (IOException | CsvValidationException | RuntimeException e) {
			return null;
		}
	}

	private boolean unsentHere(String key) {
		if (sync == null) {
			return false;
		}
		String state = sync.recordState(key);
		if (state == null) {
			// A key that is a number in the survey: Collect keeps "7" for the plot file's "007"
			String asNumbers = keyAsNumbers(key);
			if (!asNumbers.equals(key)) {
				state = sync.recordState(asNumbers);
			}
		}
		return "pending".equals(state) || "failed".equals(state); //$NON-NLS-1$ //$NON-NLS-2$
	}

	/** A key with each of its whole numbers written as Collect writes a number key: no leading zeros ("007,1" is "7,1") */
	static String keyAsNumbers(String key) {
		String[] parts = key.split(",", -1); //$NON-NLS-1$
		for (int i = 0; i < parts.length; i++) {
			if (parts[i].matches("-?\\d+")) { //$NON-NLS-1$
				parts[i] = new java.math.BigInteger(parts[i]).toString();
			}
		}
		return String.join(",", parts); //$NON-NLS-1$
	}

	/** The plot of a row: its first key columns joined by commas, as Collect Earth names its placemark and record */
	static String keyOf(String[] row, int keyColumns) {
		StringBuilder key = new StringBuilder();
		for (int i = 0; i < keyColumns && i < row.length; i++) {
			if (i > 0) {
				key.append(',');
			}
			key.append(row[i].trim());
		}
		return key.toString();
	}

	private static Set<String> keysOf(List<String[]> rows, boolean header, int keyColumns) {
		Set<String> keys = new LinkedHashSet<>();
		for (int i = header ? 1 : 0; i < rows.size(); i++) {
			keys.add(keyOf(rows.get(i), keyColumns));
		}
		return keys;
	}

	/** A header row names the columns: none of its fields is a number (rows have numeric coordinates) */
	static boolean isHeader(String[] row) {
		for (String field : row) {
			String value = field.trim().replace(',', '.');
			if (!value.isEmpty() && value.matches("[-+]?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?")) { //$NON-NLS-1$
				return false;
			}
		}
		return true;
	}

	/** A file of the server's (commas, quotes as RFC 4180): its rows, blank ones left out */
	static List<String[]> read(File file) throws IOException {
		List<String[]> rows = new ArrayList<>();
		try (Reader reader = Files.newBufferedReader(file.toPath(), StandardCharsets.UTF_8);
				CSVReader csv = new CSVReaderBuilder(reader).withCSVParser(new RFC4180ParserBuilder().withSeparator(',').build()).build()) {
			String[] row;
			while ((row = csv.readNext()) != null) {
				if (row.length == 0 || row.length == 1 && row[0].trim().isEmpty()) {
					continue;
				}
				rows.add(row);
			}
		} catch (CsvValidationException e) {
			throw new IOException("Unreadable plot file " + file.getName() + ": " + e.getMessage(), e); //$NON-NLS-1$ //$NON-NLS-2$
		}
		return rows;
	}

	/** Writes the rows (commas, quotes only where needed) when they differ from the file's; moved in once written. */
	static boolean writeIfChanged(File file, List<String[]> rows) throws IOException {
		StringWriter text = new StringWriter();
		try (Writer writer = text; CSVWriter csv = new CSVWriter(writer, ',', CSVWriter.DEFAULT_QUOTE_CHARACTER, CSVWriter.DEFAULT_ESCAPE_CHARACTER, "\n")) { //$NON-NLS-1$
			for (String[] row : rows) {
				csv.writeNext(row, false);
			}
		}
		byte[] bytes = text.toString().getBytes(StandardCharsets.UTF_8);
		if (file.isFile() && Arrays.equals(bytes, Files.readAllBytes(file.toPath()))) {
			return false;
		}
		File folder = file.getAbsoluteFile().getParentFile();
		if (!folder.isDirectory() && !folder.mkdirs()) {
			throw new IOException("Could not make the folder " + folder); //$NON-NLS-1$
		}
		Path temp = Files.createTempFile(folder.toPath(), file.getName(), ".part"); //$NON-NLS-1$
		try {
			try (OutputStream out = Files.newOutputStream(temp)) {
				out.write(bytes);
			}
			replace(temp, file.toPath());
		} finally {
			Files.deleteIfExists(temp);
		}
		return true;
	}

	/** Times a replace is tried while the file is being read (Windows refuses to replace an open file), and the wait */
	private static final int REPLACE_TRIES = 10;
	private static final long REPLACE_WAIT_MS = 300;

	/**
	 * Puts the new file in place of the old. On Windows a file being read (the plots map reading the plots, a few seconds
	 * for a big file) cannot be replaced: tried again a few times before the check gives up until the next one.
	 */
	static void replace(Path temp, Path file) throws IOException {
		for (int attempt = 1;; attempt++) {
			try {
				try {
					Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
				} catch (AtomicMoveNotSupportedException e) {
					Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
				}
				return;
			} catch (java.nio.file.FileSystemException e) {
				if (attempt >= REPLACE_TRIES || e instanceof AtomicMoveNotSupportedException) {
					throw e;
				}
				try {
					Thread.sleep(REPLACE_WAIT_MS);
				} catch (InterruptedException interrupted) {
					Thread.currentThread().interrupt();
					throw e;
				}
			}
		}
	}

	private static Map<String, String> readPlotFiles(File file) throws IOException {
		Map<String, String> files = new LinkedHashMap<>();
		if (file.isFile()) {
			for (String[] row : read(file)) {
				if (row.length >= 2) {
					files.put(row[0], row[1]);
				}
			}
		}
		return files;
	}

	private static Properties readState(File folder) {
		Properties state = new Properties();
		File file = new File(folder, STATE);
		if (file.isFile()) {
			try (InputStream in = Files.newInputStream(file.toPath())) {
				state.load(in);
			} catch (IOException e) {
				// a damaged state: the plots are asked for again
			}
		}
		return state;
	}

	private static void writeState(File folder, Properties state) throws IOException {
		if (!folder.isDirectory() && !folder.mkdirs()) {
			throw new IOException("Could not make the folder of the person's plots " + folder); //$NON-NLS-1$
		}
		// As bytes: the names of other alphabets are escaped (a plot file left out, say)
		java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
		state.store(bytes, null);
		Path temp = Files.createTempFile(folder.toPath(), STATE, ".part"); //$NON-NLS-1$
		try {
			Files.write(temp, bytes.toByteArray());
			try {
				Files.move(temp, new File(folder, STATE).toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
			} catch (AtomicMoveNotSupportedException e) {
				Files.move(temp, new File(folder, STATE).toPath(), StandardCopyOption.REPLACE_EXISTING);
			}
		} finally {
			Files.deleteIfExists(temp);
		}
	}

	// ---------------------------------------------------------------------------------------------------------------
	// What the form and the settings page ask

	/**
	 * The plot file a plot of the person's plots comes from (its name), for the record to keep as it keeps a project's own
	 * plot file's; null when the plots file is not the person's plots, or the plot is not in it.
	 */
	public String plotFileOf(String placemarkId) {
		String inUse = plotFileInUse();
		if (placemarkId == null || !isCopy(inUse)) {
			return null;
		}
		File file = new File(new File(inUse).getAbsoluteFile().getParentFile(), PLOT_FILES);
		String stamp = file.getAbsolutePath() + "@" + file.lastModified() + ":" + file.length(); //$NON-NLS-1$ //$NON-NLS-2$
		synchronized (plotFilesLock) {
			if (!stamp.equals(plotFilesStamp)) {
				try {
					plotFiles = file.isFile() ? readPlotFiles(file) : Collections.emptyMap();
				} catch (IOException e) {
					plotFiles = Collections.emptyMap();
				}
				plotFilesStamp = stamp;
			}
			return plotFiles.get(placemarkId);
		}
	}

	/** What Settings › Project shows: whether the plots come from the server, how many, when, and the training set open */
	public Map<String, Object> status() {
		Map<String, Object> status = new LinkedHashMap<>();
		boolean cloud = properties.isCloudSyncEnabled();
		File copy = cloud ? copy() : null;
		Properties state = cloud ? readState(copy.getParentFile()) : new Properties();
		status.put("mode", !cloud ? "none" : olderServer ? "files" : copy.isFile() ? "myPlots" : "pending"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$
		int plots = 0;
		if (copy != null && copy.isFile()) {
			try {
				List<String[]> rows = read(copy);
				int keyColumns = Math.max(1, Integer.parseInt(state.getProperty("keyColumns", "1"))); //$NON-NLS-1$ //$NON-NLS-2$
				plots = keysOf(rows, !rows.isEmpty() && isHeader(rows.get(0)), keyColumns).size();
			} catch (IOException | RuntimeException e) {
				plots = 0;
			}
		}
		status.put("plots", plots); //$NON-NLS-1$
		status.put("updatedAt", longOf(state.getProperty("updatedAt"))); //$NON-NLS-1$ //$NON-NLS-2$
		status.put("checkedAt", longOf(state.getProperty("checkedAt"))); //$NON-NLS-1$ //$NON-NLS-2$
		String leftOut = state.getProperty("leftOut", ""); //$NON-NLS-1$ //$NON-NLS-2$
		status.put("leftOut", leftOut.isEmpty() ? Collections.emptyList() : Arrays.asList(leftOut.split("\n"))); //$NON-NLS-1$
		status.put("unreadable", (int) Math.max(0, longOfOr(state.getProperty("unreadable"), 0))); //$NON-NLS-1$ //$NON-NLS-2$
		boolean training = cloud && onTraining();
		status.put("training", training ? new File(plotFileInUse()).getName() : null); //$NON-NLS-1$
		status.put("inUse", cloud && copy.isFile() && sameFile(copy.getAbsolutePath(), plotFileInUse())); //$NON-NLS-1$
		status.put("checkMinutes", CHECK_MINUTES); //$NON-NLS-1$
		return status;
	}

	private static Long longOf(String value) {
		try {
			return value == null ? null : Long.valueOf(value.trim());
		} catch (NumberFormatException e) {
			return null;
		}
	}

	private static long longOfOr(String value, long otherwise) {
		Long n = longOf(value);
		return n == null ? otherwise : n;
	}

	/** For the tests: the plot files read */
	Map<String, String> plotFiles(String projectId) throws IOException {
		return new HashMap<>(readPlotFiles(new File(folderOf(projectId), PLOT_FILES)));
	}
}

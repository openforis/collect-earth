package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The browsers a Collect Earth that was killed or crashed left running. A normal Quit quits them
 * ({@link BrowserService#quitAllBrowsers()}), but a killed Collect Earth runs nothing: its Chrome, Edge or Firefox and
 * their driver servers stay, and the browser keeps the imagery window's profile locked, so the next Collect Earth
 * cannot open the imagery window with it.
 * <p>
 * So each Collect Earth writes down the driver servers and browsers it started (a file in its data folder, rewritten at
 * each browser start), and deletes the file when it quits them. The next Collect Earth that finds the file ends the
 * processes in it that still run, then deletes it.
 * <p>
 * A process is ended only when all of these hold, so that nothing else is ever ended:
 * <ul>
 * <li>the Collect Earth that wrote the file is no longer running (two running at once each keep their own);</li>
 * <li>the process has the same number <em>and</em> the same start time as when it was written down (a number the
 * system gave to another program since then does not match);</li>
 * <li>it is a driver server or a browser by its program name.</li>
 * </ul>
 * Windows does not tell Java the command line of other processes, so the profile folder cannot be what identifies
 * them: the number with the start time is.
 */
class LeftoverBrowsers {

	private static final Logger logger = LoggerFactory.getLogger(LeftoverBrowsers.class);

	static final String FILE_NAME = "running_browsers.txt";

	/** The programs that may be ended: the driver servers and the browsers they start. */
	private static final List<String> PROGRAMS = List.of("chromedriver", "msedgedriver", "geckodriver", "chrome",
			"msedge", "firefox", "google chrome", "microsoft edge");

	private final File file;

	LeftoverBrowsers(File folder) {
		this.file = new File(folder, FILE_NAME);
	}

	/**
	 * Writes down this Collect Earth and the processes given (its driver servers and their browsers), replacing what
	 * was there.
	 */
	synchronized void record(List<ProcessHandle> processes) {
		List<String> lines = new ArrayList<>();
		line(ProcessHandle.current()).ifPresent(lines::add);
		if (lines.isEmpty()) {
			return; // no start time for this process: the file could not tell whether it is still running
		}
		for (ProcessHandle process : processes) {
			line(process).ifPresent(lines::add);
		}
		try {
			File folder = file.getParentFile();
			if (folder != null && !folder.isDirectory() && !folder.mkdirs()) {
				return;
			}
			Files.write(file.toPath(), lines, StandardCharsets.UTF_8);
		} catch (IOException | RuntimeException e) {
			logger.debug("Cannot write down the running browsers in {}", file, e);
		}
	}

	/** Forgets the processes written down: called once they were quit. */
	synchronized void clear() {
		try {
			Files.deleteIfExists(file.toPath());
		} catch (IOException | RuntimeException e) {
			logger.debug("Cannot delete {}", file, e);
		}
	}

	/**
	 * Ends the browsers a Collect Earth that is no longer running left behind, and returns how many processes were
	 * ended. Leaves the file of a Collect Earth that still runs alone.
	 */
	synchronized int endLeftovers() {
		if (!file.isFile()) {
			return 0;
		}
		List<String> lines;
		try {
			lines = Files.readAllLines(file.toPath(), StandardCharsets.UTF_8);
		} catch (IOException | RuntimeException e) {
			logger.debug("Cannot read {}", file, e);
			return 0;
		}
		if (lines.isEmpty()) {
			clear();
			return 0;
		}
		if (stillRunning(lines.get(0))) {
			return 0; // another Collect Earth, running now: its browsers are its own
		}
		int ended = 0;
		for (String line : lines.subList(1, lines.size())) {
			Optional<ProcessHandle> process = sameProcess(line);
			if (process.isPresent() && isBrowserOrDriver(process.get())) {
				logger.info("Ending a browser process the last Collect Earth left running: {} ({})",
						process.get().info().command().orElse("?"), process.get().pid());
				process.get().destroyForcibly();
				ended++;
			}
		}
		clear();
		return ended;
	}

	/** "pid startMillis", or nothing when the system does not say when the process started. */
	static Optional<String> line(ProcessHandle process) {
		try {
			return process.info().startInstant().map(start -> process.pid() + " " + start.toEpochMilli());
		} catch (RuntimeException e) {
			return Optional.empty();
		}
	}

	private static boolean stillRunning(String line) {
		return sameProcess(line).isPresent();
	}

	/** The process of the line, when one with that number runs and started when the line says. */
	static Optional<ProcessHandle> sameProcess(String line) {
		String[] parts = line.trim().split(" ");
		if (parts.length != 2) {
			return Optional.empty();
		}
		try {
			long pid = Long.parseLong(parts[0]);
			long start = Long.parseLong(parts[1]);
			return ProcessHandle.of(pid).filter(ProcessHandle::isAlive).filter(p -> p.info().startInstant()
					.map(Instant::toEpochMilli).map(millis -> millis == start).orElse(false));
		} catch (RuntimeException e) {
			return Optional.empty();
		}
	}

	static boolean isBrowserOrDriver(ProcessHandle process) {
		String command = process.info().command().orElse("");
		String name = new File(command).getName().toLowerCase(Locale.ENGLISH);
		if (name.endsWith(".exe")) {
			name = name.substring(0, name.length() - 4);
		}
		for (String program : PROGRAMS) {
			if (name.equals(program) || name.startsWith(program + "-") || name.startsWith(program + "_")) {
				return true;
			}
		}
		return false;
	}
}

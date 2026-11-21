package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The browsers a killed Collect Earth left running are ended at the next start, and nothing else: not those of a
 * Collect Earth still running, not a process that only has the same number now, not another program.
 */
public class LeftoverBrowsersTest {

	@TempDir
	Path folder;

	private final List<Process> started = new ArrayList<>();

	@AfterEach
	public void endStarted() {
		started.forEach(Process::destroyForcibly);
	}

	/**
	 * The arguments that keep a renamed copy of sleep waiting: {@code 60} for GNU sleep, or {@code sleep 60} where sleep
	 * is a multi-call coreutils (uutils, the default from Ubuntu 25.10, so on GitHub's ubuntu-latest), which chooses what
	 * to be by its own name and, under a name it does not know (chromedriver), by its first argument: given only
	 * {@code 60}, it ends at once. Found once, with a copy under a name no coreutils program has.
	 */
	private static List<String> sleepArguments;

	/** A process that looks like {@code name} by its program name: a copy of sleep, so Unix only. */
	private Process run(String name) throws IOException, InterruptedException {
		return start(copyOfSleep(name), sleepArguments());
	}

	private Path copyOfSleep(String name) throws IOException {
		File sleep = new File("/bin/sleep");
		assumeTrue(sleep.canExecute(), "needs /bin/sleep");
		Path program = folder.resolve(name);
		if (!Files.exists(program)) {
			Files.copy(sleep.toPath(), program, StandardCopyOption.COPY_ATTRIBUTES);
		}
		return program;
	}

	private List<String> sleepArguments() throws IOException, InterruptedException {
		if (sleepArguments == null) {
			Path probe = copyOfSleep("not-a-coreutils-program");
			for (List<String> arguments : List.of(List.of("60"), List.of("sleep", "60"))) {
				Process process = start(probe, arguments);
				boolean ended = process.waitFor(300, TimeUnit.MILLISECONDS);
				process.destroyForcibly();
				if (!ended) {
					sleepArguments = arguments;
					break;
				}
			}
			assumeTrue(sleepArguments != null, "a renamed copy of /bin/sleep does not keep running here");
		}
		return sleepArguments;
	}

	private Process start(Path program, List<String> arguments) throws IOException {
		List<String> command = new ArrayList<>();
		command.add(program.toString());
		command.addAll(arguments);
		Process process = new ProcessBuilder(command).start();
		started.add(process);
		return process;
	}

	/** The line of a Collect Earth that is no longer running: an ended process, with its start time. */
	private String endedOwner() throws Exception {
		Process owner = run("java-owner");
		String line = LeftoverBrowsers.line(owner.toHandle()).orElseThrow();
		owner.destroyForcibly().waitFor(10, TimeUnit.SECONDS);
		return line;
	}

	private void write(String... lines) throws IOException {
		Files.write(folder.resolve(LeftoverBrowsers.FILE_NAME), Arrays.asList(lines), StandardCharsets.UTF_8);
	}

	private boolean fileThere() {
		return Files.exists(folder.resolve(LeftoverBrowsers.FILE_NAME));
	}

	@Test
	public void theBrowsersOfACollectEarthNoLongerRunningAreEnded() throws Exception {
		Process driver = run("chromedriver");
		Process browser = run("chrome");
		write(endedOwner(), LeftoverBrowsers.line(driver.toHandle()).orElseThrow(),
				LeftoverBrowsers.line(browser.toHandle()).orElseThrow());
		assertEquals(2, new LeftoverBrowsers(folder.toFile()).endLeftovers());
		assertTrue(driver.waitFor(10, TimeUnit.SECONDS));
		assertTrue(browser.waitFor(10, TimeUnit.SECONDS));
		assertFalse(fileThere());
	}

	@Test
	public void theBrowsersOfACollectEarthStillRunningAreLeftAlone() throws Exception {
		Process driver = run("chromedriver");
		write(LeftoverBrowsers.line(ProcessHandle.current()).orElseThrow(),
				LeftoverBrowsers.line(driver.toHandle()).orElseThrow());
		assertEquals(0, new LeftoverBrowsers(folder.toFile()).endLeftovers());
		assertTrue(driver.isAlive());
		assertTrue(fileThere());
	}

	@Test
	public void aProcessThatOnlyHasTheSameNumberNowIsLeftAlone() throws Exception {
		Process driver = run("chromedriver");
		long start = Long.parseLong(LeftoverBrowsers.line(driver.toHandle()).orElseThrow().split(" ")[1]);
		write(endedOwner(), driver.pid() + " " + (start - 60_000));
		assertEquals(0, new LeftoverBrowsers(folder.toFile()).endLeftovers());
		assertTrue(driver.isAlive());
		assertFalse(fileThere());
	}

	@Test
	public void anotherProgramIsLeftAlone() throws Exception {
		// not "sleep": a copy under the name of a coreutils program would be that program, and take "sleep 60" as a bad time
		Process other = run("notepad");
		write(endedOwner(), LeftoverBrowsers.line(other.toHandle()).orElseThrow());
		assertEquals(0, new LeftoverBrowsers(folder.toFile()).endLeftovers());
		assertTrue(other.isAlive());
	}

	@Test
	public void recordWritesThisCollectEarthFirstAndClearForgetsIt() throws Exception {
		Process driver = run("msedgedriver");
		LeftoverBrowsers leftovers = new LeftoverBrowsers(folder.toFile());
		leftovers.record(List.of(driver.toHandle()));
		List<String> lines = Files.readAllLines(folder.resolve(LeftoverBrowsers.FILE_NAME));
		assertEquals(LeftoverBrowsers.line(ProcessHandle.current()).orElseThrow(), lines.get(0));
		assertEquals(LeftoverBrowsers.line(driver.toHandle()).orElseThrow(), lines.get(1));
		// this Collect Earth still runs: nothing is ended
		assertEquals(0, leftovers.endLeftovers());
		leftovers.clear();
		assertFalse(fileThere());
		assertTrue(driver.isAlive());
	}

	@Test
	public void browserAndDriverNamesAreRecognised() throws Exception {
		assertTrue(LeftoverBrowsers.isBrowserOrDriver(run("geckodriver").toHandle()));
		assertTrue(LeftoverBrowsers.isBrowserOrDriver(run("firefox-bin").toHandle()));
		assertTrue(LeftoverBrowsers.isBrowserOrDriver(run("msedge").toHandle()));
		assertFalse(LeftoverBrowsers.isBrowserOrDriver(run("chromium-notes").toHandle()));
		assertFalse(LeftoverBrowsers.isBrowserOrDriver(ProcessHandle.current()));
	}

	@Test
	public void aMissingOrUnreadableFileEndsNothing() throws Exception {
		assertEquals(0, new LeftoverBrowsers(folder.toFile()).endLeftovers());
		write("not a line");
		assertEquals(0, new LeftoverBrowsers(folder.toFile()).endLeftovers());
	}
}

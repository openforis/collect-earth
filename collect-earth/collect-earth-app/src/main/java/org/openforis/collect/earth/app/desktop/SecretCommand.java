package org.openforis.collect.earth.app.desktop;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Runs the system's own command that keeps a secret (macOS {@code security}, Linux {@code secret-tool}): the secret is
 * given on its standard input, never as an argument, which other programs of the computer could read in the process
 * list. The protectors take a {@link Runner}, so their tests stand in for the command.
 */
final class SecretCommand {

	private static final long TIMEOUT_SECONDS = 15;

	private SecretCommand() {
	}

	/** Runs a command with what it reads on its standard input, and gives back its exit code and outputs. */
	interface Runner {
		Result run(List<String> command, String input) throws IOException;
	}

	static final class Result {
		final int exit;
		final String output;
		final String error;

		Result(int exit, String output) {
			this(exit, output, "");
		}

		Result(int exit, String output, String error) {
			this.exit = exit;
			this.output = output;
			this.error = error;
		}
	}

	/** The real one: at most 15 seconds, then the command is ended and the run fails. */
	static Result run(List<String> command, String input) throws IOException {
		Process process = new ProcessBuilder(command).start();
		// Both outputs read while it runs: a full pipe would block it
		CompletableFuture<String> out = CompletableFuture.supplyAsync(() -> readAll(process.getInputStream()));
		CompletableFuture<String> err = CompletableFuture.supplyAsync(() -> readAll(process.getErrorStream()));
		try (OutputStream in = process.getOutputStream()) {
			in.write(input.getBytes(StandardCharsets.UTF_8));
		}
		try {
			if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
				process.destroyForcibly();
				throw new IOException(command.get(0) + " did not answer in " + TIMEOUT_SECONDS + " seconds");
			}
			return new Result(process.exitValue(), out.get(TIMEOUT_SECONDS, TimeUnit.SECONDS), err.get(TIMEOUT_SECONDS, TimeUnit.SECONDS));
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new IOException("interrupted", e);
		} catch (ExecutionException | TimeoutException e) {
			throw new IOException(e.getMessage(), e);
		}
	}

	private static String readAll(InputStream stream) {
		ByteArrayOutputStream bytes = new ByteArrayOutputStream();
		try (InputStream s = stream) {
			s.transferTo(bytes);
		} catch (IOException e) {
			// what was read
		}
		return bytes.toString(StandardCharsets.UTF_8);
	}
}

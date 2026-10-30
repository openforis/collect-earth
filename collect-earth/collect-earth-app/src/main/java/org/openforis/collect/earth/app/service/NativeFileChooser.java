package org.openforis.collect.earth.app.service;

import java.util.List;

/** A file dialog of the operating system, shown for a page that needs a path (POST /api/files/choose). */
public interface NativeFileChooser {

	enum Mode {
		OPEN, SAVE, FOLDER
	}

	/**
	 * @param extensions the extensions to show (without the dot), empty for all files
	 * @param suggested  the file or folder to start from, or null
	 * @return the absolute path chosen, or null when the user cancelled
	 * @throws NoDisplayException when there is no screen to show the dialog on
	 * @throws BusyException      when a dialog is open already
	 */
	String choose(Mode mode, List<String> extensions, String suggested);

	/**
	 * Several files to open, for the imports. An implementation that cannot offer that answers the one file chosen.
	 *
	 * @return the absolute paths chosen, empty when the user cancelled
	 */
	default List<String> chooseMany(List<String> extensions, String suggested) {
		String path = choose(Mode.OPEN, extensions, suggested);
		return path == null ? java.util.Collections.emptyList() : java.util.Collections.singletonList(path);
	}

	/** Collect Earth runs without a screen (headless), so no dialog can be shown. */
	class NoDisplayException extends RuntimeException {
		private static final long serialVersionUID = 1L;

		public NoDisplayException() {
			super("There is no display to show a file dialog on");
		}
	}

	/**
	 * A dialog is open already. A second one is refused rather than queued: queued, it would open by surprise once the
	 * user closed the first, for a page that may have given up on it, and stacked, the two would hide each other.
	 */
	class BusyException extends RuntimeException {
		private static final long serialVersionUID = 1L;

		public BusyException() {
			super("A file dialog is open already");
		}
	}
}

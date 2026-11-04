package org.openforis.collect.earth.app.desktop;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.GraphicsEnvironment;
import java.awt.Image;
import java.awt.Toolkit;
import java.net.URL;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.ImageIcon;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JProgressBar;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.WindowConstants;

import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A small window that says Collect Earth is starting, or restarting, while there is no page to say it: from the moment
 * the old process stops its server (a project or a setting changed) until the new one has opened its main window. Its
 * browser windows close with the old process, and the new one takes from a few seconds to a minute (the database, the
 * project, the plots, a browser to start) before it opens its own: with nothing on the screen meanwhile, Collect Earth
 * looked as if it had stopped.
 * <p>
 * It names what is being done ({@link #step}), shows a moving progress bar, has an entry in the taskbar (the window is
 * a frame with Collect Earth's icon), and cannot be closed by the user: it closes itself once the main window is open
 * ({@link #close}), when Collect Earth gives up starting, or after {@link #MAX_SHOWN_MS} at the latest, so it can never
 * stay over a Collect Earth that runs.
 * <p>
 * All on the Swing thread; every method may be called from any thread, and does nothing when there is no screen.
 */
public final class StartupProgressWindow {

	/** The system property the old process passes to the new one it starts (EarthApp.relaunch). */
	public static final String RESTARTING_PROPERTY = "collectEarth.restarting"; //$NON-NLS-1$

	/** The longest the window stays: a start that takes longer has failed, and says so in a message of its own. */
	static final int MAX_SHOWN_MS = 3 * 60 * 1000;

	private static final String LOGO = "images/CollectEarth.png"; //$NON-NLS-1$
	private static final String ICON = "images/macDockImageCE.png"; //$NON-NLS-1$

	private static final Logger logger = LoggerFactory.getLogger(StartupProgressWindow.class);

	// Touched on the Swing thread only
	private static JFrame frame;
	private static JLabel titleLabel;
	private static JLabel stepLabel;
	private static Timer giveUp;

	private StartupProgressWindow() {
	}

	/**
	 * Shows the window, titled {@code title} ("Restarting Collect Earth"), or gives it that title when it is already
	 * shown. Under the moving bar it says that this can take a minute, until a {@link #step} says what is being done.
	 */
	public static void show(String title) {
		if (GraphicsEnvironment.isHeadless()) {
			return;
		}
		SwingUtilities.invokeLater(() -> {
			try {
				if (frame == null) {
					build();
				}
				titleLabel.setText(wrapped(title));
				fit();
				if (!frame.isVisible()) {
					frame.setVisible(true);
					frame.toFront();
				}
				// The image of the JVM's splash screen says the same and would cover the window: it goes once this is up
				EarthApp.closeSplash();
			} catch (RuntimeException e) {
				// Collect Earth starts without it
				logger.warn("The window that shows Collect Earth starting could not be shown", e); //$NON-NLS-1$
			}
		});
	}

	/** Says what is being done now, when the window is shown. */
	public static void step(String text) {
		if (GraphicsEnvironment.isHeadless()) {
			return;
		}
		SwingUtilities.invokeLater(() -> {
			if (frame != null && frame.isVisible()) {
				stepLabel.setText(wrapped(text));
				fit();
			}
		});
	}

	/** Closes the window (its job is done, or Collect Earth gave up starting). Safe to call when it is not shown. */
	public static void close() {
		if (GraphicsEnvironment.isHeadless()) {
			return;
		}
		SwingUtilities.invokeLater(() -> {
			if (giveUp != null) {
				giveUp.stop();
				giveUp = null;
			}
			if (frame != null) {
				frame.dispose();
				frame = null;
				titleLabel = null;
				stepLabel = null;
			}
		});
	}

	/** Whether this process was started by another one restarting (a project or a setting changed). */
	public static boolean isRestart() {
		return Boolean.getBoolean(RESTARTING_PROPERTY);
	}

	/** The title of a start: "Restarting Collect Earth" when an older process started this one, else "Starting". */
	public static String startTitle() {
		return Messages.getString(isRestart() ? "StartupWindow.restarting" : "StartupWindow.starting"); //$NON-NLS-1$ //$NON-NLS-2$
	}

	private static void build() {
		frame = new JFrame("Collect Earth"); //$NON-NLS-1$
		// No title bar: nothing to close it with, as closing it would stop nothing
		frame.setUndecorated(true);
		frame.setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
		Image icon = image(ICON);
		if (icon != null) {
			frame.setIconImage(icon);
		}

		JPanel panel = new JPanel();
		panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
		panel.setBackground(Color.WHITE);
		panel.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(0xC8, 0xC8, 0xC8)),
				BorderFactory.createEmptyBorder(20, 28, 24, 28)));

		Image logo = image(LOGO);
		if (logo != null) {
			JLabel logoLabel = new JLabel(new ImageIcon(logo));
			logoLabel.setAlignmentX(0.5f);
			panel.add(logoLabel);
			panel.add(Box.createVerticalStrut(16));
		}

		titleLabel = new JLabel(" "); //$NON-NLS-1$
		titleLabel.setFont(titleLabel.getFont().deriveFont(Font.BOLD, 15f));
		titleLabel.setForeground(new Color(0x21, 0x21, 0x21));
		titleLabel.setAlignmentX(0.5f);
		panel.add(titleLabel);
		panel.add(Box.createVerticalStrut(12));

		JProgressBar bar = new JProgressBar();
		bar.setIndeterminate(true);
		bar.setMaximumSize(new Dimension(360, 8));
		bar.setPreferredSize(new Dimension(360, 8));
		bar.setAlignmentX(0.5f);
		panel.add(bar);
		panel.add(Box.createVerticalStrut(12));

		// What is being done, which the steps change; until the first one, that it takes a while
		stepLabel = new JLabel(wrapped(Messages.getString("StartupWindow.hint"))); //$NON-NLS-1$
		stepLabel.setForeground(new Color(0x61, 0x61, 0x61));
		stepLabel.setAlignmentX(0.5f);
		panel.add(stepLabel);

		frame.getContentPane().setLayout(new BorderLayout());
		frame.getContentPane().add(panel, BorderLayout.CENTER);
		fit();

		giveUp = new Timer(MAX_SHOWN_MS, e -> close());
		giveUp.setRepeats(false);
		giveUp.start();
	}

	/** The width the texts wrap at, in pixels: a long title (French, Portuguese) takes two lines, never a cut. */
	private static final int TEXT_WIDTH = 380;

	/** A text that wraps at {@link #TEXT_WIDTH}, centred, as a label shows HTML. */
	static String wrapped(String text) {
		String escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$ //$NON-NLS-6$
		return "<html><div style='text-align:center;width:" + TEXT_WIDTH + "px'>" + escaped + "</div></html>"; //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
	}

	/** Sized to what it shows now, in the middle of the screen. */
	private static void fit() {
		frame.pack();
		frame.setLocationRelativeTo(null);
	}

	/** From the jar, else from the working directory, where the installed Collect Earth has its images too. */
	private static Image image(String path) {
		URL resource = StartupProgressWindow.class.getResource("/" + path); //$NON-NLS-1$
		if (resource != null) {
			return Toolkit.getDefaultToolkit().getImage(resource);
		}
		return new java.io.File(path).exists() ? Toolkit.getDefaultToolkit().getImage(path) : null;
	}
}

package org.openforis.collect.earth.app.view;

import java.awt.Desktop;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseListener;
import java.net.URI;
import java.net.URISyntaxException;

import javax.swing.Box;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.border.EmptyBorder;

import org.openforis.collect.earth.app.service.UpdateIniUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AboutDialog extends JDialog {

	private static final long serialVersionUID = 3108968706818898461L;
	private transient Logger logger = LoggerFactory.getLogger( AboutDialog.class );

	public AboutDialog(JFrame parent, String title) {
		super(parent, title, true);
		try {
			UpdateIniUtils updateIniUtils = new UpdateIniUtils();
			String buildDate = updateIniUtils.getBuildDate();

			Box b = Box.createVerticalBox();
			b.setAlignmentX(CENTER_ALIGNMENT);
			b.setBorder(new EmptyBorder(10, 10, 10, 10));
			b.add(Box.createGlue());
			b.add(new JLabel("Collect Earth v. " + UpdateIniUtils.getVersionNameInstalled() + " ( built " + buildDate + ")  - JRE v. " + System.getProperty("java.version"))); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			b.add(new JLabel("By Open Foris Initiative / Part of the Food and Agriculture Organization of the UN")); //$NON-NLS-1$
			JLabel comp = new JLabel("<html>" + Messages.getString("AboutDialog.5") + "</html>"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			JLabel comp2 = new JLabel("<html><a href='https://github.com/openforis/collect-earth/blob/master/collect-earth/CHANGELOG.md'>CHECK THE CHANGE LOG</a></html>");
			if (isBrowsingSupported()) {
				makeLinkable(comp, new LinkMouseListener( "https://www.openforis.org" ));
				makeLinkable(comp2, new LinkMouseListener( "https://github.com/openforis/collect-earth/blob/master/collect-earth/CHANGELOG.md" ));
			}
			b.add(comp);
			b.add(comp2);
			b.add(Box.createGlue());
			getContentPane().add(b, "Center"); //$NON-NLS-1$

			JPanel p2 = new JPanel();
			JButton ok = new JButton(Messages.getString("AboutDialog.8")); //$NON-NLS-1$
			p2.add(ok);
			getContentPane().add(p2, "South"); //$NON-NLS-1$

			ok.addActionListener( e -> setVisible(false) );

			setSize(380, 150);
		}catch(Exception e) {
			logger.error( "Error showing About dialog", e );
		}
	}

	private static void makeLinkable(JLabel c, MouseListener ml) {
		assert ml != null;

		c.setCursor(new java.awt.Cursor(java.awt.Cursor.HAND_CURSOR));
		c.addMouseListener(ml);
	}

	private static boolean isBrowsingSupported() {
		if (!Desktop.isDesktopSupported()) {
			return false;
		}
		boolean result = false;
		Desktop desktop = java.awt.Desktop.getDesktop();
		if (desktop.isSupported(Desktop.Action.BROWSE)) {
			result = true;
		}
		return result;

	}

	private static class LinkMouseListener extends MouseAdapter {
		String url;


		public LinkMouseListener(String url) {
			super();
			this.url = url;
		}


		@Override
		public void mouseClicked(java.awt.event.MouseEvent evt) {
			JLabel l = (JLabel) evt.getSource();
			try {

				URI uri = new java.net.URI(url); //$NON-NLS-1$
				(new LinkRunner(uri)).execute();
			} catch (URISyntaxException use) {
				throw new AssertionError(use + ": " + l.getText()); //NOI18N //$NON-NLS-1$
			}
		}
	}

}

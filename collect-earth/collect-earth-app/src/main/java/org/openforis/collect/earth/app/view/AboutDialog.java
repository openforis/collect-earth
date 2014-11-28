package org.openforis.collect.earth.app.view;

import java.awt.Desktop;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseListener;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Properties;
import java.util.concurrent.ExecutionException;

import javax.swing.Box;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.SwingWorker;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AboutDialog extends JDialog {

	private static final long serialVersionUID = 3108968706818898461L;
	private Logger logger = LoggerFactory.getLogger( AboutDialog.class );

	public AboutDialog(JFrame parent, String title) {
		super(parent, title, true);

	    Box b = Box.createVerticalBox();
	    b.add(Box.createGlue());
	    b.add(new JLabel("Collect Earth ( build " + getVersion() + " )"));
	    b.add(new JLabel("By Open Foris Initiative"));
	    JLabel comp = new JLabel("<html>" + "For more information visit <a href='http://www.openforis.org'>our website</a>" + "</html>");
	    if (isBrowsingSupported()) {
	        makeLinkable(comp, new LinkMouseListener());
	    }
		b.add(comp);
	    b.add(Box.createGlue());
	    getContentPane().add(b, "Center");

	    JPanel p2 = new JPanel();
	    JButton ok = new JButton("Ok");
	    p2.add(ok);
	    getContentPane().add(p2, "South");

	    ok.addActionListener(new ActionListener() {
			
			@Override
			public void actionPerformed(ActionEvent e) {
				
			        setVisible(false);
			    
			}
	    });

	    setSize(250, 150);
	}

	private String getVersion() {
		
		Properties properties = new Properties();
		String version = "unknwown";
		try {
			properties.load( new FileInputStream("update.ini"));
			version = properties.getProperty("version_id");
		} catch (FileNotFoundException e) {
			logger.error("The update.,ini file could not be found", e);
		} catch (IOException e) {
			logger.error("Error opening the update.ini file", e);
		}
		
		
		return version;
		
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

	    @Override
	    public void mouseClicked(java.awt.event.MouseEvent evt) {
	        JLabel l = (JLabel) evt.getSource();
	        try {
	            URI uri = new java.net.URI("http://www.openforis.org");
	            (new LinkRunner(uri)).execute();
	        } catch (URISyntaxException use) {
	            throw new AssertionError(use + ": " + l.getText()); //NOI18N
	        }
	    }
	}

	private static class LinkRunner extends SwingWorker<Void, Void> {

	    private final URI uri;

	    private LinkRunner(URI u) {
	        if (u == null) {
	            throw new NullPointerException();
	        }
	        uri = u;
	    }

	    @Override
	    protected Void doInBackground() throws Exception {
	        Desktop desktop = java.awt.Desktop.getDesktop();
	        desktop.browse(uri);
	        return null;
	    }

	    @Override
	    protected void done() {
	        try {
	            get();
	        } catch (ExecutionException ee) {
	            handleException(uri, ee);
	        } catch (InterruptedException ie) {
	            handleException(uri, ie);
	        }
	    }

	    private static void handleException(URI u, Exception e) {
	        JOptionPane.showMessageDialog(null, "Sorry, a problem occurred while trying to open this link in your system's standard browser.", "A problem occured", JOptionPane.ERROR_MESSAGE);
	    }
	}

}

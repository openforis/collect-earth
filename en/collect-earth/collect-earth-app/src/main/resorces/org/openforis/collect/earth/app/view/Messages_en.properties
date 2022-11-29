package org.openforis.collect.earth.app.view;

import java.awt.Desktop;
import java.net.URI;
import java.util.concurrent.ExecutionException;

import javax.swing.JOptionPane;
import javax.swing.SwingWorker;

class LinkRunner extends SwingWorker<Void, Void> {

    private final URI uri;

    LinkRunner(URI u) {
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
            handleException();
        } catch (InterruptedException e) {
        	handleException();
        	Thread.currentThread().interrupt();
		}
    }

    private static void handleException() {
        JOptionPane.showMessageDialog(null, Messages.getString("AboutDialog.6"), Messages.getString("AboutDialog.19"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$ //$NON-NLS-2$
    }
}
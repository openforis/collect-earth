package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.net.URI;
import java.net.URISyntaxException;

public class OpenSupportForum implements ActionListener {

	@Override
	public void actionPerformed(ActionEvent e) {
		try {
            URI uri = new java.net.URI("http://www.openforis.org/support"); //$NON-NLS-1$
            (new LinkRunner(uri)).execute();
        } catch (URISyntaxException use) {
            throw new AssertionError(use + ": " + "Open FOris support"); //NOI18N //$NON-NLS-1$
        }

	}

}

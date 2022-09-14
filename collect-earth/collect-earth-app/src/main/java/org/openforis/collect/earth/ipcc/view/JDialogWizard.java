/*******************************************************************************
 * Copyright (c) 2012 Gustav Karlsson <gustav.karlsson@gmail.com>.
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the GNU Public License v3.0
 * which accompanies this distribution, and is available at
 * http://www.gnu.org/licenses/gpl.html
 * 
 * Contributors:
 *     Gustav Karlsson <gustav.karlsson@gmail.com> - initial API and implementation
 ******************************************************************************/
package org.openforis.collect.earth.ipcc.view;

import java.awt.Dimension;
import java.awt.Frame;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.GridLayout;
import java.awt.Insets;
import java.awt.Toolkit;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.event.ContainerEvent;
import java.awt.event.ContainerListener;
import java.awt.event.KeyEvent;

import javax.swing.AbstractButton;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JSeparator;

import se.gustavkarlsson.gwiz.Wizard;

/**
 * A very simple <code>Wizard</code> implementation that suits the most basic needs. Extends {@link JFrame} and has
 * navigation buttons at the bottom.
 * 
 * @author Gustav Karlsson <gustav.karlsson@gmail.com>
 */
public class JDialogWizard extends JDialog implements Wizard {
	private static final long serialVersionUID = 2818290889333414291L;

	private static final Dimension defaultminimumSize = new Dimension(500, 500);

	private final JPanel wizardPageContainer = new JPanel(new GridLayout(1, 1));
	private final JButton cancelButton = new JButton(Messages.getString("JDialogWizard.0")); //$NON-NLS-1$
	private final JButton previousButton = new JButton(Messages.getString("JDialogWizard.1")); //$NON-NLS-1$
	private final JButton nextButton = new JButton(Messages.getString("JDialogWizard.2")); //$NON-NLS-1$
	private final JButton finishButton = new JButton(Messages.getString("JDialogWizard.3")); //$NON-NLS-1$
	
	private boolean wizardFinished = false;

	/**
	 * Creates an <code>JDialogWizard</code> with a title and <code>GraphicsConfiguration</code>.
	 * 
	 * @param title
	 *            the title of the frame
	 * @param gc
	 *            the <code>GraphicsConfiguration</code> of the frame
	 * @see JFrame
	 */
	public JDialogWizard(Frame owner, String title, boolean modal) {
		super(owner, title, modal);
		setupWizard();
	}

	/**
	 * Creates an <code>JDialogWizard</code>.
	 * 
	 * @see JFrame
	 */
	public JDialogWizard() {
		super();
		setupWizard();
	}

	/**
	 * Sets up wizard upon construction.
	 */
	private void setupWizard() {
		setupComponents();
		layoutComponents();

		setMinimumSize(defaultminimumSize);

		// Center on screen
		Dimension screenSize = Toolkit.getDefaultToolkit().getScreenSize();
		int xPosition = (screenSize.width / 2) - (defaultminimumSize.width / 2);
		int yPosition = (screenSize.height / 2) - (defaultminimumSize.height / 2);
		setLocation(xPosition, yPosition);

		setDefaultCloseOperation(DISPOSE_ON_CLOSE);
	}

	/**
	 * Sets up the components of the wizard with listeners and mnemonics.
	 */
	private void setupComponents() {
		cancelButton.addActionListener(new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent e) {
				dispose();
			}
		});

		finishButton.addActionListener(new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent e) {
				//JOptionPane.showMessageDialog(getContentPane(), Messages.getString("JDialogWizard.4")); //$NON-NLS-1$
				wizardFinished = true;
				dispose();
			}
		});

		cancelButton.setMnemonic(KeyEvent.VK_C);
		previousButton.setMnemonic(KeyEvent.VK_P);
		nextButton.setMnemonic(KeyEvent.VK_N);
		finishButton.setMnemonic(KeyEvent.VK_F);

		wizardPageContainer.addContainerListener(new MinimumSizeAdjuster());
	}

	/**
	 * Lays out the components in the wizards content pane.
	 */
	private void layoutComponents() {
		GridBagLayout layout = new GridBagLayout();
		layout.rowWeights = new double[]{1.0, 0.0, 0.0};
		layout.columnWeights = new double[]{1.0, 0.0, 0.0, 0.0, 0.0};
		layout.rowHeights = new int[] {0, 0, 0};
		layout.columnWidths = new int[] {0, 0, 0, 0, 0};
		getContentPane().setLayout(layout);

		GridBagConstraints wizardPageContainerConstraint = new GridBagConstraints();
		wizardPageContainerConstraint.gridwidth = 5;
		wizardPageContainerConstraint.fill = GridBagConstraints.BOTH;
		wizardPageContainerConstraint.gridx = 0;
		wizardPageContainerConstraint.gridy = 0;
		wizardPageContainerConstraint.insets = new Insets(5, 5, 5, 5);
		getContentPane().add(wizardPageContainer, wizardPageContainerConstraint);

		GridBagConstraints separatorConstraints = new GridBagConstraints();
		separatorConstraints.gridwidth = 5;
		separatorConstraints.fill = GridBagConstraints.HORIZONTAL;
		separatorConstraints.gridx = 0;
		separatorConstraints.gridy = 1;
		separatorConstraints.insets = new Insets(5, 5, 5, 5);
		getContentPane().add(new JSeparator(), separatorConstraints);

		GridBagConstraints cancelButtonConstraints = new GridBagConstraints();
		cancelButtonConstraints.gridx = 1;
		cancelButtonConstraints.gridy = 2;
		cancelButtonConstraints.insets = new Insets(5, 5, 5, 0);
		getContentPane().add(cancelButton, cancelButtonConstraints);

		GridBagConstraints previousButtonConstraints = new GridBagConstraints();
		previousButtonConstraints.gridx = 2;
		previousButtonConstraints.gridy = 2;
		previousButtonConstraints.insets = new Insets(5, 5, 5, 0);
		getContentPane().add(previousButton, previousButtonConstraints);

		GridBagConstraints nextButtonConstraints = new GridBagConstraints();
		nextButtonConstraints.gridx = 3;
		nextButtonConstraints.gridy = 2;
		nextButtonConstraints.insets = new Insets(5, 5, 5, 0);
		getContentPane().add(nextButton, nextButtonConstraints);

		GridBagConstraints finishButtonConstraints = new GridBagConstraints();
		finishButtonConstraints.gridx = 4;
		finishButtonConstraints.gridy = 2;
		finishButtonConstraints.insets = new Insets(5, 5, 5, 5);
		getContentPane().add(finishButton, finishButtonConstraints);
	}

	@Override
	public JPanel getWizardPageContainer() {
		return wizardPageContainer;
	}

	@Override
	public AbstractButton getCancelButton() {
		return cancelButton;
	}

	@Override
	public JButton getPreviousButton() {
		return previousButton;
	}

	@Override
	public JButton getNextButton() {
		return nextButton;
	}

	@Override
	public JButton getFinishButton() {
		return finishButton;
	}

	private class MinimumSizeAdjuster implements ContainerListener {

		@Override
		public void componentAdded(ContainerEvent e) {
			Dimension currentSize = getSize();
			Dimension preferredSize = getPreferredSize();

			Dimension newSize = new Dimension(currentSize);
			newSize.width = Math.max(currentSize.width, preferredSize.width);
			newSize.height = Math.max(currentSize.height, preferredSize.height);

			setMinimumSize(newSize);
		}

		@Override
		public void componentRemoved(ContainerEvent e) {
		}

	}

	public boolean isWizardFinished() {
		return wizardFinished;
	}

}

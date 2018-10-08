package org.openforis.collect.earth.app.view;

import java.awt.Window;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.util.HashMap;
import java.util.Set;

import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JList;
import javax.swing.JOptionPane;
import javax.swing.JRadioButton;
import javax.swing.text.JTextComponent;

import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class ApplyOptionChangesListener implements ActionListener {
	private LocalPropertiesService localPropertiesService;
	private HashMap<Enum<?>, JComponent[]> propertyToComponent;
	private final Logger logger = LoggerFactory.getLogger(this.getClass());
	protected Window callingDialog;


	public ApplyOptionChangesListener(Window callingDialog, LocalPropertiesService localPropertiesService, HashMap<Enum<?>, JComponent[]> propertyToComponent) {
		this.callingDialog = callingDialog;
		this.localPropertiesService = localPropertiesService;
		this.propertyToComponent = propertyToComponent;

	}

	public ApplyOptionChangesListener(Window callingDialog, LocalPropertiesService localPropertiesService) {
		this.callingDialog = callingDialog;
		this.localPropertiesService = localPropertiesService;
	}

	@Override
	public void actionPerformed(ActionEvent arg0) {
		try {
			startWaiting();
			applyProperties();
		} catch (final Exception e) {
			logger.error("Error applying the new properties", e); //$NON-NLS-1$
		} finally {
			endWaiting();
		}
	}

	private void setPropertyValue( Enum<?> enumKey, String value ){

		localPropertiesService.setValue((EarthProperty) enumKey, value);

	}

	protected abstract void applyProperties();

	public void savePropertyValues() {
		final Set<Enum<?>> keySet = propertyToComponent.keySet();
		for (final Enum<?> propertyKey : keySet) {
			final JComponent component = propertyToComponent.get(propertyKey)[0];
			if( !component.isVisible() ) {
				setPropertyValue(propertyKey, "");
			}else {
				if (component instanceof JTextComponent) {
					setPropertyValue(propertyKey, ((JTextComponent) component).getText());
				} else if (component instanceof JCheckBox) {
					setPropertyValue(propertyKey, ((JCheckBox) component).isSelected() + ""); //$NON-NLS-1$
				} else if (component instanceof JComboBox) {
					if (((JComboBox) component).getItemAt(0) instanceof ComboBoxItem) {
						setPropertyValue(propertyKey,
								((ComboBoxItem) ((JComboBox) component).getSelectedItem()).getNumberOfPoints() + ""); //$NON-NLS-1$
					} else if (((JComboBox) component).getItemAt(0) instanceof String) {
						setPropertyValue(propertyKey, ((String) ((JComboBox) component).getSelectedItem() ) ); //$NON-NLS-1$
					} else if (((JComboBox) component).getItemAt(0) instanceof SAMPLE_SHAPE) {
						setPropertyValue(propertyKey,  ( (SAMPLE_SHAPE) ((JComboBox) component).getSelectedItem() ).name() );
					}
				} else if (component instanceof JList) {
					setPropertyValue(propertyKey, ((JList) component).getSelectedValue() + ""); //$NON-NLS-1$
				} else if (component instanceof JRadioButton) {
					final JComponent[] jComponents = propertyToComponent.get(propertyKey);
					for (final JComponent jComponent : jComponents) {
						if (((JRadioButton) jComponent).isSelected()) {
							setPropertyValue(propertyKey, ((JRadioButton) jComponent).getName());
						}
					}
				} else if (component instanceof JFilePicker) {
					setPropertyValue(propertyKey, ((JFilePicker) component).getSelectedFilePath());
				}
			}
		}
	}

	public void restartEarth() {
		localPropertiesService.nullifyChecksumValues();

		try {
			// Re-generate KMZ
			new Thread("Restarting Collect Earth after changing properties/loading project/loading KML points"){
				public void run() {
					EarthApp.restart();
				};
			}.start();


			JOptionPane.showMessageDialog( callingDialog, Messages.getString("OptionWizard.20"), //$NON-NLS-1$
					Messages.getString("OptionWizard.21"), JOptionPane.INFORMATION_MESSAGE); //$NON-NLS-1$
			if( callingDialog!= null && callingDialog instanceof PropertiesDialog){
				callingDialog.dispose();
			}

		} catch (final Exception e) {
			logger.error("Error when re-generating the KML code to open in GE ", e); //$NON-NLS-1$
			JOptionPane.showMessageDialog(callingDialog, e.getMessage(), Messages.getString("OptionWizard.23"), //$NON-NLS-1$
					JOptionPane.WARNING_MESSAGE);
		}
	}

	private void startWaiting() {
		if( callingDialog != null ){
			callingDialog.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.WAIT_CURSOR));
		}
	}


	private void endWaiting() {
		if( callingDialog != null ){
			callingDialog.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.DEFAULT_CURSOR));
		}
	}
}

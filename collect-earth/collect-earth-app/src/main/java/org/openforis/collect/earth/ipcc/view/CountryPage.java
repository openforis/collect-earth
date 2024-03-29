package org.openforis.collect.earth.ipcc.view;

import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.util.List;

import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;
import javax.swing.border.TitledBorder;

import org.openforis.collect.earth.ipcc.RegionColumnEnum;
import org.openforis.collect.earth.ipcc.model.CountryCode;
import org.openforis.collect.earth.ipcc.model.CountryUtils;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class CountryPage extends AbstractWizardPage {

	private static final long serialVersionUID = -6050069120207527953L;
	
	private AbstractWizardPage nextPage;

	public CountryPage( AbstractWizardPage nextPage, AssignSubdivisionTypesWizard assignSubdivisionTypesWizard, List<String> attributeNames ) {

	
		this.nextPage = nextPage;

		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;

		JPanel contentPane = new JPanel(new GridBagLayout());
		JScrollPane scrollPane = new JScrollPane(contentPane);
		scrollPane.setHorizontalScrollBarPolicy(JScrollPane.HORIZONTAL_SCROLLBAR_AS_NEEDED);
		scrollPane.setVerticalScrollBarPolicy(JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED);
		scrollPane.setBounds(50, 30, 300, 50);
		scrollPane.setPreferredSize(new Dimension(450, 350));

		final Border border = new TitledBorder(new BevelBorder(BevelBorder.LOWERED), "Information on the survey");
		setBorder(border);

		constraints.gridx = 0;

		JLabel labelCountry = new JLabel("Country");
		contentPane.add(labelCountry, constraints);

		constraints.gridx = 1;

		JComboBox<CountryCode> countryList = new JComboBox(CountryUtils.getCountryList());
		countryList.addActionListener( e -> {assignSubdivisionTypesWizard.setCountryCode( ( (CountryCode) countryList.getSelectedItem() ) );} );
	
		contentPane.add(countryList, constraints);

		constraints.gridy++;
		
		constraints.gridx = 0;

		JLabel labelRegion = new JLabel("Collect Earth Region attribute (country,region,district)");
		contentPane.add(labelRegion, constraints);
		

		constraints.gridx = 1;
		
		String[] attrNamesArray = new String[ attributeNames.size() ];
		attributeNames.toArray(attrNamesArray );
		JComboBox<String> attributeList = new JComboBox(attrNamesArray);
		
		attributeList.addActionListener( e -> {assignSubdivisionTypesWizard.setRegionAttribute( ( (String) attributeList.getSelectedItem() ) );} );

		if( attributeNames.contains( RegionColumnEnum.PROVINCE.getColumnName() ) ){
			attributeList.setSelectedItem( RegionColumnEnum.PROVINCE.getColumnName() );
		}else if( attributeNames.contains( RegionColumnEnum.COUNTRY.getColumnName() ) ){
			attributeList.setSelectedItem( RegionColumnEnum.COUNTRY.getColumnName() );
		}
		else if( attributeNames.contains( RegionColumnEnum.DISTRICT.getColumnName() ) ){
			attributeList.setSelectedItem( RegionColumnEnum.DISTRICT.getColumnName() );
		}

		contentPane.add(attributeList, constraints);

		constraints.gridy++;

		this.add(scrollPane);

	}

	@Override
	protected AbstractWizardPage getNextPage() {
		return nextPage;
	}

	@Override
	protected boolean isCancelAllowed() {
		return false;
	}

	@Override
	protected boolean isPreviousAllowed() {
		return false;
	}

	@Override
	protected boolean isNextAllowed() {
		return true;
	}

	@Override
	protected boolean isFinishAllowed() {
		return false;
	}

}

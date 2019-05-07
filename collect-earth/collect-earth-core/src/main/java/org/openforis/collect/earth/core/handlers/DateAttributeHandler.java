package org.openforis.collect.earth.core.handlers;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;

import org.openforis.idm.metamodel.DateAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Date;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class DateAttributeHandler extends AbstractAttributeHandler<Date> {

	private static final String PREFIX = "date_";

	public static final String DATE_ATTRIBUTE_FORMAT = "MM/dd/yyyy";
	

	public DateAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getParameterValue(Date value) {
		if (value == null) {
			return null;
		}
		try {
			java.util.Date javaDate = value.toJavaDate();

			return javaDate == null ? null : new SimpleDateFormat( DATE_ATTRIBUTE_FORMAT).format(javaDate);

		} catch(Exception e) {
			return null;
		}
	}
	
	@Override
	public Date createValue(String parameterValue) {
		// month/day/year
		Date date;
		try {

			java.util.Date dateParam =new SimpleDateFormat(DATE_ATTRIBUTE_FORMAT).parse(parameterValue);

			Calendar cal = Calendar.getInstance();
			cal.setTime(dateParam);
			int year = cal.get(Calendar.YEAR);
			int month = cal.get(Calendar.MONTH) + 1; // Months starts with 0 in
			// the calendar
			int day = cal.get(Calendar.DAY_OF_MONTH);
			if( year > 2200 ){
				throw new IllegalArgumentException("Error in the year specified " + year );
			}
			date = new Date(year, month, day);
		} catch (ParseException e) {
			date = new Date(-1, -1, -1); // Force Collect validation to respond
		}
		return date;
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof DateAttributeDefinition;
	}
	

}

package org.openforis.collect.earth.core.handlers;

import java.text.ParseException;
import java.text.ParsePosition;
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
	

	/** Forces the validation of Collect to mark the field as invalid */
	private static final Date INVALID_DATE = new Date(-1, -1, -1);

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
		String text = parameterValue == null ? "" : parameterValue.trim();

		SimpleDateFormat format = new SimpleDateFormat(DATE_ATTRIBUTE_FORMAT);
		// Without this a date like 02/31/2025 was silently rolled over into the next month
		format.setLenient(false);

		ParsePosition position = new ParsePosition(0);
		java.util.Date dateParam = format.parse(text, position);
		// The whole value has to be a date : parse() alone accepted anything that starts with one
		if (dateParam == null || position.getIndex() != text.length()) {
			return INVALID_DATE;
		}

		Calendar cal = Calendar.getInstance();
		cal.setTime(dateParam);
		int year = cal.get(Calendar.YEAR);
		int month = cal.get(Calendar.MONTH) + 1; // Months starts with 0 in
		// the calendar
		int day = cal.get(Calendar.DAY_OF_MONTH);
		if( year > 2200 ){
			// This used to throw an IllegalArgumentException, which is not a ParseException : it escaped the catch and was
			// swallowed further up instead of marking the field as invalid
			return INVALID_DATE;
		}
		return new Date(year, month, day);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof DateAttributeDefinition;
	}
	

}

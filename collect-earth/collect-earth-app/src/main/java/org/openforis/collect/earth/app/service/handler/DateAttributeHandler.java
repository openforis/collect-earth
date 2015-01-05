package org.openforis.collect.earth.app.service.handler;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;

import org.apache.log4j.Logger;
import org.openforis.idm.model.Date;
import org.openforis.idm.model.DateAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Node;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class DateAttributeHandler extends AbstractAttributeHandler<Date> {

	private static final String PREFIX = "date_";

	public static final SimpleDateFormat DATE_ATTRIBUTE_FORMAT = new SimpleDateFormat("MM/dd/yyyy");

	public DateAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), getDate(parameterValue));
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		
		String cleanName = removePrefix(parameterName);
		if( entity.get(cleanName, index) == null){
			return "";
		}
		
		String attribute = "";

		try {
			if(  entity.get(cleanName, index).hasData() ){

				java.util.Date javaDate = ((DateAttribute) entity.get(cleanName, index)).getValue().toJavaDate();
				
				attribute = DATE_ATTRIBUTE_FORMAT.format(javaDate);
			}
		} catch (Exception e) {
			Logger.getLogger(this.getClass()).error("Not able to parse date for paramaeter " + parameterName, e);
			throw new IllegalArgumentException("Error in the date specified for parameter " + parameterName );
		}
		return attribute;
	}

	@Override
	public Date getAttributeValue(String parameterValue) {
		return getDate(parameterValue);
	}

	private Date getDate(String parameterValue) {
		// month/day/year
		Date date;
		try {
			java.util.Date dateParam = DATE_ATTRIBUTE_FORMAT.parse(parameterValue);
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
	public boolean isParseable(Node value) {
		return value instanceof DateAttribute;
	}
}

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
import org.openforis.idm.model.Value;

public class DateAttributeHandler extends AbstractAttributeHandler<Value> {

	private static final String PREFIX = "date_";

	private final SimpleDateFormat sdf = new SimpleDateFormat("MM/dd/yyyy");

	public DateAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		String attribute = "";

		try {
			attribute = sdf.format(((DateAttribute) entity.get(removePrefix(parameterName), index)).getValue().toJavaDate());
		} catch (Exception e) {
			Logger.getLogger(this.getClass()).error("Not able to parse date", e);
		}
		return attribute;
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), getDate(parameterValue));
	}

	private Date getDate(String parameterValue) {
		// month/day/year
		Date date;
		try {
			java.util.Date dateParam = sdf.parse(parameterValue);
			Calendar cal = Calendar.getInstance();
			cal.setTime(dateParam);
			int year = cal.get(Calendar.YEAR);
			int month = cal.get(Calendar.MONTH) + 1; // Months starts with 0 in
			// the calendar
			int day = cal.get(Calendar.DAY_OF_MONTH);

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

	@Override
	public Value getAttributeValue(String parameterValue) {
		return getDate(parameterValue);
	}
}

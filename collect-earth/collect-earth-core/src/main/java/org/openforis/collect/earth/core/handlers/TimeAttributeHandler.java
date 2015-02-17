package org.openforis.collect.earth.core.handlers;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.TimeAttributeDefinition;
import org.openforis.idm.model.Time;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class TimeAttributeHandler extends AbstractAttributeHandler<Time> {

	private static final String PREFIX = "time_";

	public static final SimpleDateFormat TIME_ATTRIBUTE_FORMAT = new SimpleDateFormat("HH:mm");

	public TimeAttributeHandler() {
		super(PREFIX);
	}
	
	@Override
	public String getParameterValue(Time value) {
		if (value == null) {
			return null;
		}
		try {
			Calendar calendar = value.toCalendar();
			Date javaDate = calendar.getTime();
			return calendar == null ? null : TIME_ATTRIBUTE_FORMAT.format(javaDate);
		} catch(Exception e) {
			return null;
		}
	}
	
	@Override
	public Time createValue(String parameterValue) {
		Time time = Time.parseTime(parameterValue);
		return time;
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof TimeAttributeDefinition;
	}

}

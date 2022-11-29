package org.openforis.collect.earth.planet;

import java.text.SimpleDateFormat;
import java.util.Date;

public class DatePlanet extends Date {
	private static final long serialVersionUID = 1L;
	private static final String DATE_FORMAT = "yyyy-MM-ddTHH:mm:ss.SSSZ";
	
	public DatePlanet(Date date) {
		super(date.getTime());
	}
	
	@Override
	public String toString() {
		SimpleDateFormat simpleDateFormat = new SimpleDateFormat(DATE_FORMAT);
		return simpleDateFormat.format(this);
	}

}

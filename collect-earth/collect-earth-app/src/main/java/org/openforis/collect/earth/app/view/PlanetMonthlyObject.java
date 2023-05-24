package org.openforis.collect.earth.app.view;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Objects;

public class PlanetMonthlyObject {

	public static final PlanetMonthlyObject STARTING_DATE = new PlanetMonthlyObject("First available", "" );
	public static final PlanetMonthlyObject PRESENT_DATE = new PlanetMonthlyObject("Latest available", "" );

	public static PlanetMonthlyObject[] getPlanetMonthlyMosaics() {
		
		ArrayList<PlanetMonthlyObject> planetMosaics = new ArrayList<PlanetMonthlyObject>();
		planetMosaics.add( STARTING_DATE);
		planetMosaics.add( new PlanetMonthlyObject("2015/12 - 2016/05", "2015-12_2016-05"));
		planetMosaics.add( new PlanetMonthlyObject("2016/06 - 2016/11", "2016-06_2016-11"));
		planetMosaics.add( new PlanetMonthlyObject("2016/12 - 2017/05", "2016-12_2017-05"));
		planetMosaics.add( new PlanetMonthlyObject("2017/06 - 2017/11", "2017-06_2017-11"));
		planetMosaics.add( new PlanetMonthlyObject("2017/12 - 2018/05", "2017-12_2018-05"));
		planetMosaics.add( new PlanetMonthlyObject("2018/06 - 2018/11", "2018-06_2018-11"));
		planetMosaics.add( new PlanetMonthlyObject("2018/12 - 2019/05", "2018-12_2019-05"));
		planetMosaics.add( new PlanetMonthlyObject("2019/06 - 2019/11", "2019-06_2019-11"));
		planetMosaics.add( new PlanetMonthlyObject("2019/12 - 2020/05", "2019-12_2020-05"));
		planetMosaics.add( new PlanetMonthlyObject("2020/06 - 2020/08", "2020-06_2020-08"));
		planetMosaics.add( new PlanetMonthlyObject("2020/09", "2020-09"));
		planetMosaics.add( new PlanetMonthlyObject("2020/10", "2020-10"));
		planetMosaics.add( new PlanetMonthlyObject("2020/11", "2020-11"));
		planetMosaics.add( new PlanetMonthlyObject("2020/12", "2020-12"));
		
		Calendar c = Calendar.getInstance();
		int nowYear = c.get(Calendar.YEAR);
		int nowMonth = c.get(Calendar.MONTH) + 1;
		int nowDay = c.get(Calendar.DAY_OF_MONTH);
		
		for( int y = 2021; y<= nowYear-1; y++ ) {
			for( int m = 1; m<12; m++ ) {
				String monthStr = m+"";
				if( m<10) {
					monthStr = "0"+m;
				}
				planetMosaics.add( new PlanetMonthlyObject( y+"/"+monthStr, y+"-"+monthStr));
			}
		}
		
		for( int m = 1; m<nowMonth; m++ ) {
			String monthStr = m+"";
			if( m<10) {
				monthStr = "0"+m;
			}
			if( nowMonth-1 == m && nowDay < 10 ) { // There will be no imagery for the latest month until the 10th of the next month
				break;
			}
			planetMosaics.add( new PlanetMonthlyObject( nowYear+"/"+monthStr, nowYear+"-"+monthStr));
		
		}
		planetMosaics.add( PRESENT_DATE);
		return  (PlanetMonthlyObject[]) planetMosaics.toArray( new PlanetMonthlyObject[] {} );
	}

	public static PlanetMonthlyObject getPlanetMonthlyObject(String value) {
		for (PlanetMonthlyObject planetMonthlyObject : getPlanetMonthlyMosaics()) {
			if( planetMonthlyObject.getValue().equals( value )) {
				return planetMonthlyObject;
			}
		} 
		return STARTING_DATE;
	}

	private String dateLabel;
	private String value;
	
	public PlanetMonthlyObject(String dateLabel, String value) {
		this.dateLabel = dateLabel;
		this.value = value;
	}

	@Override
	public String toString() {
		return dateLabel;
	}

	public String getDateLabel() {
		return dateLabel;
	}

	public String getValue() {
		return value;
	}

	public void setDateLabel(String dateLabel) {
		this.dateLabel = dateLabel;
	}

	public void setValue(String value) {
		this.value = value;
	}

	@Override
	public int hashCode() {
		return Objects.hash(dateLabel, value);
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		PlanetMonthlyObject other = (PlanetMonthlyObject) obj;
		return Objects.equals(dateLabel, other.dateLabel) && Objects.equals(value, other.value);
	}
	
}

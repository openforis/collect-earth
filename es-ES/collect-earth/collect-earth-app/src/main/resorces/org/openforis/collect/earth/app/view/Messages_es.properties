package org.openforis.collect.earth.planet;

import java.text.SimpleDateFormat;
import java.util.Date;

public class Test {


	public static void main(String[] args) {
		try {
			PlanetImagery planet = new PlanetImagery( "YOUR API KEY FOR DAILY IMAGERY" );
			SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd");
			Date start = formatter.parse("2013-01-01");
			Date end =  formatter.parse("2013-12-01");
			String[] itemTypes = {"PSScene3Band", "PSScene4Band", "REOrthoTile"};/*
			double[][][] coords = {{
				{
					-1.8230438232421875,
					5.66433079911972
				},
				{
					-1.8195247650146482,
					5.66433079911972
				},
				{
					-1.8195247650146482,
					5.6671493748802915
				},
				{
					-1.8230438232421875,
					5.6671493748802915
				},
				{
					-1.8230438232421875,
					5.66433079911972
				}  }
			};
			*/

			double[][][] coords = {{{148.440013,-5.763688}, {148.440645,-5.763688}, {148.440645,-5.76432}, {148.440013,-5.76432}, {148.440013,-5.763688}}};
			//double[][][] coords = {{{-39.611883, -72.612975}, {-39.611883, -72.611833}, {-39.612765, -72.611833}, {-39.612765, -72.612975}, {-39.611883, -72.612975}}};
			System.out.println(
					planet.getAvailableDates( new PlanetRequestParameters(start, end, coords, itemTypes) )
			);
			System.out.println(
					planet.getLayerUrl( new PlanetRequestParameters(start, end, coords, itemTypes) )
			);
		} catch (Exception e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}
	}
}
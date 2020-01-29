package org.openforis.collect.earth.planet;

import java.text.SimpleDateFormat;
import java.util.Date;

public class Test {


	public static void main(String[] args) {
		try {
			PlanetImagery planet = new PlanetImagery( "8dfb61e5458c4d3ab595dc24e160b55b" );
			SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd");
			Date start = formatter.parse("2019-11-01");
			Date end =  formatter.parse("2019-12-01");
			String[] itemTypes = {"PSScene3Band", "PSScene4Band"};/*
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
			
			double[][][] coords = {{{-1.457541, 114.592016}, {-1.457541, 114.592896}, {-1.458427, 114.592896}, {-1.458427, 114.592016}, {-1.457541, 114.592016}}};*/
			double[][][] coords = {{{-39.611883, -72.612975}, {-39.611883, -72.611833}, {-39.612765, -72.611833}, {-39.612765, -72.612975}, {-39.611883, -72.612975}}};
			System.out.println( 
					planet.getLayerUrl(start, end, coords, itemTypes ) 
			);
		} catch (Exception e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}
	}
}
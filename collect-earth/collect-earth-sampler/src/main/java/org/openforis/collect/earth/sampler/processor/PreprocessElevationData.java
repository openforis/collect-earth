package org.openforis.collect.earth.sampler.processor;

import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.ArrayList;
import java.util.List;

import org.geotools.coverage.grid.GridCoverage2D;
import org.geotools.gce.geotiff.GeoTiffReader;
import org.geotools.geometry.DirectPosition2D;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.opengis.coverage.PointOutsideCoverageException;
import org.opengis.referencing.FactoryException;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;

import com.vividsolutions.jts.geom.Point;

public class PreprocessElevationData extends AbstractWgs84Transformer {

	private static final int SLOPE_PERCENTAGE_LIMIT = 10;
	public static final String CSV_ELEV_EXTENSIOM = ".ced";
	private static final Logger logger = LoggerFactory.getLogger(PreprocessElevationData.class);
	private static String NEW_LINE = System.getProperty("line.separator");
	private static int GRID_SIZE = 90;
	private List<GridCoverage2D> gridsWithElevationData;
	private Integer sidePlotInMeters;
	private final DecimalFormat df;

	private enum SlopeDirection {
		NORTH_SOUTH, WEST_EAST;
	};

	private enum Orientation {
		NORTH, NORTH_EAST, EAST, SOUTH_EAST, SOUTH, SOUTH_WEST, WEST, NORTH_WEST, FLAT, UNKNOWN
	};

	public PreprocessElevationData(String epsgCode) {
		super(epsgCode);
		//this.sidePlotInMeters = sidePlotInMeters;
		this.sidePlotInMeters = 2 * GRID_SIZE;
		DecimalFormatSymbols dfs = DecimalFormatSymbols.getInstance();
		dfs.setDecimalSeparator('.');
		df = new DecimalFormat("#.##", dfs);
	}

	public boolean addElevationDataAndFixToWgs84(List<File> elevationGeoTiffs, File csvFile) {
		boolean success = true;
		OutputStream overwriteToNewFile = null;
		try {
			gridsWithElevationData = loadGrids(elevationGeoTiffs);

			overwriteToNewFile = getFileOverWrite(csvFile);

			CSVReader reader = getCsvReader(csvFile);
			String[] nextRow;
			while ((nextRow = reader.readNext()) != null) {
				try {
					overwritePlacemarkInfo(nextRow, overwriteToNewFile);
				} catch (IllegalArgumentException e) {
					logger.error("Elevation not found but let us continue", e);
				}
			}

		} catch (IOException e) {
			logger.error("Unable to process elevation data", e);
			success = false;
		} catch (TransformException e) {
			logger.error("Unable to transform point into WGS84 CRS ", e);
			success = false;
		} catch (FactoryException e) {
			logger.error("Unable to process elevation data", e);
			success = false;
		} finally {
			if (overwriteToNewFile != null) {
				try {
					overwriteToNewFile.close();
				} catch (IOException e) {
					logger.error("Error when closing CSV with elevation output stream", e);
				}
			}
		}

		return success;
	}

	private CSVReader getCsvReader(File csvFile) throws FileNotFoundException {
		BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile),
				Charset.forName("UTF-8")));
		CSVReader reader = new CSVReader(bufferedReader, ',');
		return reader;
	}

	private Integer getElevationOnWgs84Point(GridCoverage2D searchGrid, double xCoordinate, double yCoordinate,
			boolean keepSearching) {

		Integer elevation = null;
		try {
			int[] metadataAtPoint = (int[]) searchGrid.evaluate(new DirectPosition2D(DefaultGeographicCRS.WGS84, xCoordinate,
					yCoordinate));
			elevation = metadataAtPoint[0];
		} catch (PointOutsideCoverageException e) {
			logger.debug("Cannot find elevation data for this point : " + xCoordinate + " , " + yCoordinate + " in grid "
					+ searchGrid);
		}

		if (elevation == null && keepSearching) {
			for (GridCoverage2D elevationGrid : gridsWithElevationData) {
				if( elevationGrid != null ){
					elevation = getElevationOnWgs84Point(elevationGrid, xCoordinate, yCoordinate, false);
					if( elevation!=null){
						break;
					}
				}

			}
			if (elevation == null) {
				throw new PointOutsideCoverageException("None of the GeoTifs contains data for coordinates " + xCoordinate
						+ " , " + yCoordinate);
			}
		}

		return elevation;
	}

	private OutputStream getFileOverWrite(File csvFile) throws IOException {

		String name = csvFile.getName();
		File newFile = new File(csvFile.getParent(), name + CSV_ELEV_EXTENSIOM);
		BufferedOutputStream bos = new BufferedOutputStream(new FileOutputStream(newFile));
		return bos;
	}

	private GridCoverage2D getGridFromGeoTiff(File geoTiff) throws IOException {
		GeoTiffReader reader = new GeoTiffReader(geoTiff);
		return reader.read(null);

	}

	private List<GridCoverage2D> loadGrids(List<File> elevationGeoTiffs) throws IOException {
		List<GridCoverage2D> grids = new ArrayList<GridCoverage2D>();
		for (File geoTiff : elevationGeoTiffs) {
			grids.add(getGridFromGeoTiff(geoTiff));
		}
		return grids;
	}

	private void overwritePlacemarkInfo( String[] nextRow, OutputStream overwriteToNewFile)
			throws TransformException, FactoryException, IOException {
		double originalX = Double.parseDouble(nextRow[1]);
		double originalY = Double.parseDouble(nextRow[2]);
		Point wgs84Point = transformToWGS84(originalX, originalY); // TOP-LEFT
		String placemarkId = nextRow[0];

		String slope = "0:0";
		String elevation = "-1";
		String orientation = "UNKNOWN";
		boolean foundElevation = false;


		for (GridCoverage2D elevationGrid : gridsWithElevationData) {

			Integer elevationOnWgs84Point = getElevationOnWgs84Point(elevationGrid, wgs84Point.getX(), wgs84Point.getY(), false);

			if (elevationOnWgs84Point != null) {
				// Slope as a percentage ( i.e. : 8 meters difference in 100 meters line)
				double northSouthSlope = getSlope(elevationGrid, wgs84Point, SlopeDirection.NORTH_SOUTH, sidePlotInMeters);
				double westEastSlope = getSlope(elevationGrid, wgs84Point, SlopeDirection.WEST_EAST, sidePlotInMeters);

				orientation = calculateOrientation(northSouthSlope, westEastSlope).name();
				elevation = elevationOnWgs84Point.toString();
				slope = df.format(northSouthSlope) + ":" + df.format(westEastSlope);

				foundElevation = true;
				break;
			}

		}

		// No elevation data found for point
		String[] newValues = { placemarkId, wgs84Point.getX() + "", wgs84Point.getY() + "", elevation, slope, orientation };
		writeLineToCsv(overwriteToNewFile, newValues);

		if (!foundElevation) {
			throw new IllegalArgumentException("There is no elevation data for point with coordinates : Long "
					+ wgs84Point.getX() + " Lat " + wgs84Point.getY());
		}

	}

	private Orientation calculateOrientation(double northSouthSlope, double westEastSlope) {
		if (northSouthSlope > SLOPE_PERCENTAGE_LIMIT) {
			if (westEastSlope > SLOPE_PERCENTAGE_LIMIT) {
				return Orientation.NORTH_WEST;
			} else if (westEastSlope < -SLOPE_PERCENTAGE_LIMIT) {
				return Orientation.NORTH_EAST;
			} else {
				return Orientation.NORTH;
			}
		} else if (northSouthSlope < -SLOPE_PERCENTAGE_LIMIT) {
			if (westEastSlope > SLOPE_PERCENTAGE_LIMIT) {
				return Orientation.SOUTH_WEST;
			} else if (westEastSlope < -SLOPE_PERCENTAGE_LIMIT) {
				return Orientation.SOUTH_EAST;
			} else {
				return Orientation.SOUTH;
			}
		} else {
			if (westEastSlope > SLOPE_PERCENTAGE_LIMIT) {
				return Orientation.WEST;
			} else if (westEastSlope < -SLOPE_PERCENTAGE_LIMIT) {
				return Orientation.EAST;
			} else {
				return Orientation.FLAT;
			}
		}
	}

	private double getSlope(GridCoverage2D grid, Point centerPoint, SlopeDirection direction, Integer sideLength) {

		// The elevation grid has a 90 meter resolution ( 90x90 cells).
		// To calculate the slope we use the sideLength, if this is smaller than 180 meters then we change it to 180 m
		// to make sure that more than one "elevation cell" is used and increase the accuracy.
		// The slope is calculated using the average slope on the grid, given all the possible North-South and West-East lines.

		if (sideLength < 2 * GRID_SIZE) {
			sideLength = 2 * GRID_SIZE;
		}

		double offset = sideLength / 2d;
		int numberOfObserbations = (sideLength / GRID_SIZE) + 1;
		double observationSum = 0;
		double[] center = new double[] { centerPoint.getX(), centerPoint.getY() };

		try {
			double[] southEastCorner = getPointWithOffset(center, -offset, offset); // Move north-west

			for (int i = 0; i < numberOfObserbations; i++) {
				double[] pointStart, pointEnd;
				if (direction.equals(SlopeDirection.NORTH_SOUTH)) {
					pointStart = getPointWithOffset(southEastCorner, GRID_SIZE * i, 0); // Move West by 90*i meters
					pointEnd = getPointWithOffset(southEastCorner, GRID_SIZE * i, -sideLength); // Move West by 90*i meters and North by 180 m
				} else {
					pointStart = getPointWithOffset(southEastCorner, 0, -GRID_SIZE * i); // Move North by 90*i meters
					pointEnd = getPointWithOffset(southEastCorner, sideLength, -GRID_SIZE * i); // Move North by 90*i meters and West by 180 m
				}

				double elevationAtStart;
				double elevationAtEnd;
				try {
					elevationAtStart = getElevationOnWgs84Point(grid, pointStart[0], pointStart[1], true);
					elevationAtEnd = getElevationOnWgs84Point(grid, pointEnd[0], pointEnd[1], true);

					observationSum += ((elevationAtEnd - elevationAtStart) / (double) sideLength) * 100d;
				} catch (Exception e) {
					// TODO Auto-generated catch block
					e.printStackTrace();
				}

			}
		} catch (TransformException e) {
			getLogger().error("Error transforming point coordinates ", e);
		}
		return observationSum / numberOfObserbations;
	}

	// values : ID,LONG,LAT,ELEV
	private void writeLineToCsv(OutputStream csvOutputStream, String[] values) throws IOException {
		String csvLine = "";
		for (String csvColumn : values) {
			csvLine += csvColumn + ",";
		}
		csvLine = csvLine.substring(0, csvLine.length() - 1) + NEW_LINE;
		csvOutputStream.write(csvLine.getBytes());
	}

	// ID< LONG, LAT , ELEVATION

}

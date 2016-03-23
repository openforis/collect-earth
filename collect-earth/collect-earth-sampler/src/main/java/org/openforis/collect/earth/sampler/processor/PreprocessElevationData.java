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
import org.geotools.referencing.GeodeticCalculator;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.openforis.collect.earth.sampler.utils.GeoUtils;
import org.opengis.coverage.PointOutsideCoverageException;
import org.opengis.referencing.FactoryException;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;

import com.vividsolutions.jts.geom.Point;

public class PreprocessElevationData extends AbstractCoordinateCalculation {

	public static final String CSV_ELEV_EXTENSION = ".ced";
	private static final Logger logger = LoggerFactory.getLogger(PreprocessElevationData.class);
	private static String NEW_LINE = System.getProperty("line.separator");
	private List<GridCoverage2D> gridsWithElevationData;
	private final DecimalFormat df;
	private final GeodeticCalculator geodeticCalculator = new GeodeticCalculator();

	public PreprocessElevationData(String epsgCode) {
		super(epsgCode);

		final DecimalFormatSymbols dfs = DecimalFormatSymbols.getInstance();
		dfs.setDecimalSeparator('.');
		df = new DecimalFormat("#.##", dfs);
	}

	public boolean addElevationDataAndFixToWgs84(List<File> elevationGeoTiffs, File csvFile) {
		boolean success = true;
		OutputStream overwriteToNewFile = null;
		try {
			gridsWithElevationData = loadGrids(elevationGeoTiffs);

			overwriteToNewFile = getFileOverWrite(csvFile);

			final CSVReader reader = getCsvReader(csvFile);
			String[] nextRow;
			while ((nextRow = reader.readNext()) != null) {
				try {
					overwritePlacemarkInfo(nextRow, overwriteToNewFile);
				} catch (final IllegalArgumentException e) {
					logger.error("Elevation not found but let us continue", e);
				}
			}

		} catch (final IOException e) {
			logger.error("Unable to process elevation data", e);
			success = false;
		} catch (final TransformException e) {
			logger.error("Unable to transform point into WGS84 CRS ", e);
			success = false;
		} catch (final FactoryException e) {
			logger.error("Unable to process elevation data", e);
			success = false;
		} finally {
			if (overwriteToNewFile != null) {
				try {
					overwriteToNewFile.close();
				} catch (final IOException e) {
					logger.error("Error when closing CSV with elevation output stream", e);
				}
			}
		}

		return success;
	}

	private double calculateAspect(double[] afWin) {
		// See : http://svn.osgeo.org/gdal/trunk/gdal/apps/gdaldem.cpp
		final double degreesToRadians = Math.PI / 180.0;

		double aspect;

		final double dx = ((afWin[2] + afWin[5] + afWin[5] + afWin[8]) - (afWin[0] + afWin[3] + afWin[3] + afWin[6]));

		final double dy = ((afWin[6] + afWin[7] + afWin[7] + afWin[8]) - (afWin[0] + afWin[1] + afWin[1] + afWin[2]));

		aspect = (float) (Math.atan2(dy, -dx) / degreesToRadians);

		if (dx == 0 && dy == 0) {
			/* Flat area */
			aspect = -1;
		} else if (aspect < 0) {
			aspect += 360.0;
		}

		if (aspect == 360.0) {
			aspect = 0.0;
		}

		return aspect;
	}

	private CSVReader getCsvReader(File csvFile) throws FileNotFoundException {
		final BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), Charset.forName("UTF-8")));
		final CSVReader reader = new CSVReader(bufferedReader, ',');
		return reader;
	}

	private double[] getElevationMatrix(GridCoverage2D grid, Point centerPoint, double gridSize) {

		final double offset = gridSize + 1;
		final double[] elevationMatrix = new double[9];
		final double[] center = new double[] { centerPoint.getX(), centerPoint.getY() };

		try {
			final double[] topLeftCorner = getPointWithOffset(center, -offset, offset); // Move north-west
			// Copying algorightm from GDALDEM http://svn.osgeo.org/gdal/trunk/gdal/apps/gdaldem.cpp
			// Top Left 0 Top center 1 Top Right 2 Mid Left 3 Mid center 4 Mid right 5 bottom left 6 Bottom center 7 Bottom right 8
			int index = 0;
			for (int row = 0; row < 3; row++) {
				for (int col = 0; col < 3; col++) {
					final double[] cellPoint = getPointWithOffset(topLeftCorner, gridSize * col, -gridSize * row);
					elevationMatrix[index++] = getElevationOnWgs84Point(grid, cellPoint[0], cellPoint[1], true);
				}
			}
		} catch (final Exception e) {
			logger.error("Error getting the elevation-matrix", e);
		}
		return elevationMatrix;
	}

	private Integer getElevationOnWgs84Point(GridCoverage2D searchGrid, double xCoordinate, double yCoordinate, boolean keepSearching) {

		Integer elevation = null;
		try {
			final int[] metadataAtPoint = (int[]) searchGrid.evaluate(new DirectPosition2D(DefaultGeographicCRS.WGS84, xCoordinate, yCoordinate));
			elevation = metadataAtPoint[0];
		} catch (final PointOutsideCoverageException e) {
			logger.debug("Cannot find elevation data for this point : " + xCoordinate + " , " + yCoordinate + " in grid " + searchGrid);
		}

		if (elevation == null && keepSearching) {
			for (final GridCoverage2D elevationGrid : gridsWithElevationData) {
				if (elevationGrid != null) {
					elevation = getElevationOnWgs84Point(elevationGrid, xCoordinate, yCoordinate, false);
					if (elevation != null) {
						break;
					}
				}

			}
			if (elevation == null) {
				throw new PointOutsideCoverageException("None of the GeoTifs contains data for coordinates " + xCoordinate + " , " + yCoordinate);
			}
		}

		return elevation;
	}

	private OutputStream getFileOverWrite(File csvFile) throws IOException {

		final String name = csvFile.getName();
		final File newFile = new File(csvFile.getParent(), name + CSV_ELEV_EXTENSION);
		final BufferedOutputStream bos = new BufferedOutputStream(new FileOutputStream(newFile));
		return bos;
	}

	private GridCoverage2D getGridFromGeoTiff(File geoTiff) throws IOException {
		final GeoTiffReader reader = new GeoTiffReader(geoTiff);
		return reader.read(null);

	}

	private double getGridSizeAtPosition(double longitude, double latitude) {

		geodeticCalculator.setStartingGeographicPoint(longitude, latitude);
		latitude = latitude + 3d / 3600d;
		geodeticCalculator.setDestinationGeographicPoint(longitude, latitude);

		return geodeticCalculator.getOrthodromicDistance();
	}

	private double getSlope(double[] elevationMatrix, double gridSize) {

		// For the slope algorithm check
		// http://www.cs.bgu.ac.il/~icbv071/Readings/1981-Horn-Hill_Shading_and_the_Reflectance_Map.pdf
		// http://svn.osgeo.org/gdal/trunk/gdal/apps/gdaldem.cpp
		double dx, dy, key;

		dx = ((elevationMatrix[0] + elevationMatrix[3] + elevationMatrix[3] + elevationMatrix[6]) - (elevationMatrix[2] + elevationMatrix[5]
				+ elevationMatrix[5] + elevationMatrix[8]))
				/ gridSize;

		dy = ((elevationMatrix[6] + elevationMatrix[7] + elevationMatrix[7] + elevationMatrix[8]) - (elevationMatrix[0] + elevationMatrix[1]
				+ elevationMatrix[1] + elevationMatrix[2]))
				/ gridSize;

		key = (dx * dx + dy * dy);

		return 100 * (Math.sqrt(key) / 8);
	}

	private List<GridCoverage2D> loadGrids(List<File> elevationGeoTiffs) throws IOException {
		final List<GridCoverage2D> grids = new ArrayList<GridCoverage2D>();
		for (final File geoTiff : elevationGeoTiffs) {
			grids.add(getGridFromGeoTiff(geoTiff));
		}
		return grids;
	}

	private void overwritePlacemarkInfo(String[] nextRow, OutputStream overwriteToNewFile) throws TransformException, FactoryException, IOException {
		final double originalX = Double.parseDouble(nextRow[1]);
		final double originalY = Double.parseDouble(nextRow[2]);
		final Point wgs84Point = GeoUtils.transformToWGS84(originalX, originalY, "EPSG:8326"); // TOP-LEFT
		final String placemarkId = nextRow[0];

		String elevation = "-1";
		Double aspect = Double.valueOf(-1);
		Double slope = Double.valueOf(-1);
		boolean foundElevation = false;

		for (final GridCoverage2D elevationGrid : gridsWithElevationData) {
			final double gridSize = getGridSizeAtPosition(wgs84Point.getX(), wgs84Point.getY());
			final Integer elevationOnWgs84Point = getElevationOnWgs84Point(elevationGrid, wgs84Point.getX(), wgs84Point.getY(), false);

			if (elevationOnWgs84Point != null) {
				final double[] elevationMatrix = getElevationMatrix(elevationGrid, wgs84Point, gridSize);

				slope = getSlope(elevationMatrix, gridSize);
				aspect = calculateAspect(elevationMatrix);
				elevation = elevationOnWgs84Point.toString();

				foundElevation = true;
				break;
			}

		}

		// No elevation data found for point
		final String[] newValues = { placemarkId, wgs84Point.getX() + "", wgs84Point.getY() + "", elevation, df.format(slope), df.format(aspect) };
		writeLineToCsv(overwriteToNewFile, newValues);

		if (!foundElevation) {
			throw new IllegalArgumentException("There is no elevation data for point with coordinates : Long " + wgs84Point.getX() + " Lat "
					+ wgs84Point.getY());
		}

	}

	// values : ID,LONG,LAT,ELEV
	private void writeLineToCsv(OutputStream csvOutputStream, String[] values) throws IOException {
		final StringBuilder csvLine = new StringBuilder();
		for (final String csvColumn : values) {
			csvLine.append(csvColumn).append(",");
		}
		final String csvLineStr = csvLine.substring(0, csvLine.length() - 1) + NEW_LINE;
		csvOutputStream.write(csvLineStr.getBytes());
	}

}

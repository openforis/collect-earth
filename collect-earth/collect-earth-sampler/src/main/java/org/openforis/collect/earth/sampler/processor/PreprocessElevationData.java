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
import java.util.ArrayList;
import java.util.List;

import org.geotools.coverage.grid.GridCoverage2D;
import org.geotools.data.DataSourceException;
import org.geotools.gce.geotiff.GeoTiffReader;
import org.geotools.geometry.DirectPosition2D;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.opengis.referencing.FactoryException;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;

import com.vividsolutions.jts.geom.Point;

public class PreprocessElevationData extends AbstractWgs84Transformer {

	public static final String ELEV_SUFFIX = "_elev";
	private static final Logger logger = LoggerFactory.getLogger(PreprocessElevationData.class);
	private static String NEW_LINE = System.getProperty("line.separator");

	/**
	 * @param args
	 */
	public static void main(String[] args) {
		File file = new File("C:\\srtm_54_07\\srtm_54_07.tif");

		GeoTiffReader reader;
		try {
			reader = new GeoTiffReader(file);
			GridCoverage2D coverage = reader.read(null);

			int[] whatever = (int[]) coverage.evaluate(new DirectPosition2D(DefaultGeographicCRS.WGS84, 89.6d, 27.7d));
			System.out.println(whatever[0]);
		} catch (DataSourceException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		} catch (IOException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}


	}

	public PreprocessElevationData(String epsgCode) {
		super(epsgCode);
	}

	public boolean addElevationDataAndFixToWgs84(List<File> elevationGeoTiffs, File csvFile) {
		boolean success = true;
		OutputStream overwriteToNewFile = null;
		try {
			List<GridCoverage2D> grids = loadGrids(elevationGeoTiffs);

			overwriteToNewFile = getFileOverWrite(csvFile);

			CSVReader reader = getCsvReader(csvFile);
			String[] nextRow;
			while ((nextRow = reader.readNext()) != null) {
				overwritePlacemarkInfo(grids, nextRow, overwriteToNewFile);
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

	private Integer getElevationOnWgs84Point(GridCoverage2D coverage, Point coordinateWgs84) {
		int[] whatever = (int[]) coverage.evaluate(new DirectPosition2D(DefaultGeographicCRS.WGS84, coordinateWgs84.getX(),
				coordinateWgs84.getY()));
		return whatever[0];
	}

	private OutputStream getFileOverWrite(File csvFile) throws IOException {

		String name = csvFile.getName();
		File newFile = new File(csvFile.getParent(), name + ELEV_SUFFIX);
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

	private void overwritePlacemarkInfo(List<GridCoverage2D> grids, String[] nextRow, OutputStream overwriteToNewFile)
			throws TransformException, FactoryException, IOException {
		double originalX = Double.parseDouble(nextRow[1]);
		double originalY = Double.parseDouble(nextRow[2]);
		Point transformedPoint = transformToWGS84(originalX, originalY); // TOP-LEFT

		for (GridCoverage2D grid : grids) {

			try {
				Integer elevationOnWgs84Point = getElevationOnWgs84Point(grid, transformedPoint);
				String placemarkId = nextRow[0];
				String[] newValues = { placemarkId, transformedPoint.getX() + "", transformedPoint.getY() + "",
						elevationOnWgs84Point + "" };

				writeLineToCsv(overwriteToNewFile, newValues);

				return;
			} catch (Exception e) {
				logger.debug("The grid contains no data por point " + transformedPoint);
			}

		}

		throw new IllegalAccessError("There is no elevation data for point with coordinates : Long " + originalX + " Lat "
				+ originalY);

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

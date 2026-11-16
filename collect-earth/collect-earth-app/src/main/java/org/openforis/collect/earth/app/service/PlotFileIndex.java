package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.opencsv.CSVReader;

/**
 * The plot file, read once for everything that looks a plot up (the plots map's list, a plot opened, the statuses, the
 * generated form's plot values): each plot's id, label, place and row, kept against the file and the plot settings. A
 * plot's shape is made from its row when it is asked for (a plot is some 8 KB of geometry with its sample points), so
 * 500,000 plots are read in seconds and held in a few hundred MB at most.
 */
@Component
public class PlotFileIndex {

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private KmlGeneratorService kmlGeneratorService;

	private final Logger logger = LoggerFactory.getLogger(PlotFileIndex.class);
	private final ObjectMapper json = new ObjectMapper();

	/** The plot file read once, against its path, last change and the plot settings (see {@link #indexOf}). */
	private volatile PlotIndex cachedIndex;

	/** "path@lastModified" of the plot file, "" when there is none (LeafletMapController.plotsVersion). */
	static String plotsVersion(String csvFile) {
		if (csvFile == null || csvFile.trim().isEmpty()) {
			return "";
		}
		File csv = new File(csvFile);
		return csv.exists() ? csvFile + "@" + csv.lastModified() : "";
	}

	/**
	 * The plot file read, kept against its path and last change: concurrent first requests (the list, the statuses)
	 * read it once. Each row is made into a plot only for its id, label and place, which every plot shape gives
	 * without its sample points.
	 */
	public synchronized PlotIndex indexOf(String csvFile) throws Exception {
		File csv = new File(csvFile);
		PlotIndex index = cachedIndex;
		// Kept while the plot file is the same and so are the plot settings (the shape, its distances, the CRS): with
		// another shape the plots have other outlines, and in another CRS other places
		String settings = kmlGeneratorService.plotShapeSettings();
		if (index != null && csvFile.equals(index.csvPath) && csv.lastModified() == index.lastModified && settings.equals(index.settings)) {
			return index;
		}
		KmlGenerator kmlGenerator = kmlGeneratorService.getKmlGenerator();
		if (kmlGenerator == null) {
			throw new IllegalStateException("The plot settings cannot make the plots' shape");
		}
		List<String> ids = new java.util.ArrayList<>();
		List<String> labels = new java.util.ArrayList<>();
		List<double[]> places = new java.util.ArrayList<>();
		List<String[]> rows = new java.util.ArrayList<>();
		Map<String, Integer> position = new java.util.HashMap<>();
		String[] headerRow = null;
		try (CSVReader reader = CsvReaderUtils.getCsvReader(csvFile)) {
			String[] csvRow;
			while ((csvRow = reader.readNext()) != null) {
				// The first row names the columns. Without it the plot properties carried no CSV column ( round,
				// climate, ... ) and the $[EXTRA_*] of the form stayed unsubstituted
				if (headerRow == null) {
					headerRow = csvRow;
				}
				try {
					SimplePlacemarkObject plot = kmlGenerator.getPlotObject(csvRow, headerRow, earthSurveyService.getCollectSurvey(), false);
					String id = plot.getPlacemarkId();
					double[] place = { Double.parseDouble(plot.getCoord().getLatitude()), Double.parseDouble(plot.getCoord().getLongitude()) };
					String label = plot.getVisiblePlacemarkId() != null && !plot.getVisiblePlacemarkId().equals(id) ? plot.getVisiblePlacemarkId() : null;
					Integer known = position.get(id);
					if (known != null) {
						// A plot twice keeps the place it first had, with its last row (as the map always showed it)
						labels.set(known, label);
						places.set(known, place);
						rows.set(known, csvRow);
						continue;
					}
					position.put(id, ids.size());
					ids.add(id);
					labels.add(label);
					places.add(place);
					rows.add(csvRow);
				} catch (Exception rowError) {
					// header row or malformed row - skipped
					logger.debug("Skipping CSV row: {}", (Object) csvRow);
				}
			}
		}
		index = new PlotIndex(csvFile, csv.lastModified(), settings, kmlGenerator, headerRow, ids, labels, places, rows, position, json);
		cachedIndex = index;
		return index;
	}

	/** The plot file read: each plot's id, label, place and row, and the index's answer. */
	public static final class PlotIndex {
		public final String csvPath;
		public final long lastModified;
		public final String settings;
		/** The plot shape's generator, which reads the whole plot file to be chosen (KmlGeneratorService.getKmlGenerator) */
		public final KmlGenerator generator;
		public final String[] header;
		public final String[] ids;
		public final double[] latitudes;
		public final double[] longitudes;
		public final String[][] rows;
		public final Map<String, Integer> position;
		public final Set<String> idSet;
		public final String json;

		public PlotIndex(String csvPath, long lastModified, String settings, KmlGenerator generator, String[] header, List<String> ids, List<String> labels, List<double[]> places,
				List<String[]> rows, Map<String, Integer> position, com.fasterxml.jackson.databind.ObjectMapper mapper) throws IOException {
			this.csvPath = csvPath;
			this.lastModified = lastModified;
			this.settings = settings;
			this.generator = generator;
			this.header = header;
			this.ids = ids.toArray(new String[0]);
			this.rows = rows.toArray(new String[0][]);
			this.position = position;
			this.idSet = new HashSet<>(ids);
			this.latitudes = new double[places.size()];
			this.longitudes = new double[places.size()];
			for (int i = 0; i < places.size(); i++) {
				latitudes[i] = places.get(i)[0];
				longitudes[i] = places.get(i)[1];
			}
			Map<String, Object> answer = new LinkedHashMap<>();
			answer.put("plots", plotsVersion(csvPath));
			answer.put("ids", this.ids);
			answer.put("labels", labels);
			answer.put("latitudes", latitudes);
			answer.put("longitudes", longitudes);
			this.json = mapper.writeValueAsString(answer);
		}

		/** The plots within `radiusMeters` of the plot at `at`, itself included, the nearest first, at most `limit`. */
		public List<Integer> near(int at, double radiusMeters, int limit) {
			double cosLat = Math.cos(Math.toRadians(latitudes[at]));
			List<double[]> found = new java.util.ArrayList<>();
			for (int i = 0; i < ids.length; i++) {
				double dy = (latitudes[i] - latitudes[at]) * METERS_PER_DEGREE;
				double dx = (longitudes[i] - longitudes[at]) * METERS_PER_DEGREE * cosLat;
				double d = Math.hypot(dx, dy);
				if (d <= radiusMeters) found.add(new double[] { d, i });
			}
			found.sort((a, b) -> Double.compare(a[0], b[0]));
			List<Integer> out = new java.util.ArrayList<>();
			for (int i = 0; i < found.size() && i < limit; i++) out.add((int) found.get(i)[1]);
			return out;
		}

		/** Metres in a degree of latitude, as the plots map measured it (plots.ts) */
		static final double METERS_PER_DEGREE = 111_320;
	}

}

package org.openforis.collect.earth.app.service.settings;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * What SettingsValidator found: an error or a warning per setting, in the UI language, and the figures of the plot
 * the page shows under its preview. Sent to the page as it is (toJson); the errors keep the settings from being saved,
 * the warnings do not.
 */
public final class Validation {

	/** The plot as the plot settings describe it, in hectares and metres; the reference figures only when there is one. */
	public static final class PlotFigures {
		private final double plotAreaHa;
		private final Double referenceAreaHa;
		private final Integer minReferenceDistance;
		private final Integer recommendedReferenceDistance;

		PlotFigures(PlotGeometry plot) {
			plotAreaHa = PlotGeometry.hectares(plot.plotArea());
			if (plot.hasReferenceArea()) {
				referenceAreaHa = PlotGeometry.hectares(plot.referenceArea());
				minReferenceDistance = plot.minimumReferenceDistance();
				recommendedReferenceDistance = plot.recommendedReferenceDistance();
			} else {
				referenceAreaHa = null;
				minReferenceDistance = null;
				recommendedReferenceDistance = null;
			}
		}

		public double getPlotAreaHa() {
			return plotAreaHa;
		}

		public Double getReferenceAreaHa() {
			return referenceAreaHa;
		}

		public Integer getMinReferenceDistance() {
			return minReferenceDistance;
		}

		public Integer getRecommendedReferenceDistance() {
			return recommendedReferenceDistance;
		}

		Map<String, Object> toJson() {
			Map<String, Object> json = new LinkedHashMap<>();
			json.put("plotAreaHa", plotAreaHa);
			json.put("referenceAreaHa", referenceAreaHa);
			json.put("minReferenceDistance", minReferenceDistance);
			json.put("recommendedReferenceDistance", recommendedReferenceDistance);
			return json;
		}
	}

	private final Map<String, String> errors = new TreeMap<>();
	private final Map<String, String> warnings = new TreeMap<>();
	private PlotFigures plot;

	/** The first error of a setting is the one kept: the next rules of it are not run. */
	void error(String key, String message) {
		errors.putIfAbsent(key, message);
	}

	void warning(String key, String message) {
		warnings.putIfAbsent(key, message);
	}

	boolean hasError(String key) {
		return errors.containsKey(key);
	}

	void plot(PlotGeometry geometry) {
		plot = geometry.hasArea() ? new PlotFigures(geometry) : null;
	}

	public boolean isValid() {
		return errors.isEmpty();
	}

	public Map<String, String> getErrors() {
		return Collections.unmodifiableMap(errors);
	}

	public Map<String, String> getWarnings() {
		return Collections.unmodifiableMap(warnings);
	}

	/** Null for a plot shape that has no area of its own (a polygon read from the file, a cluster) */
	public PlotFigures getPlot() {
		return plot;
	}

	public Map<String, Object> toJson() {
		Map<String, Object> json = new LinkedHashMap<>();
		json.put("errors", errors);
		json.put("warnings", warnings);
		json.put("plot", plot == null ? null : plot.toJson());
		return json;
	}
}

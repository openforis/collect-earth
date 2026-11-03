package org.openforis.collect.earth.app.service.settings;

import java.io.File;
import java.net.MalformedURLException;
import java.net.URL;
import java.text.MessageFormat;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.function.Predicate;
import java.util.function.Supplier;

import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * The rules of the settings, which the Swing dialog ran in its InputVerifiers (PropertyValidators,
 * ReferenceAreaDistanceVerifier) and its panels, run by the server for the page: on every change while the user
 * types, and before saving. Only the settings shown for the values are checked, as the dialog checked only the
 * visible fields. An error keeps the settings from being saved; a warning is only shown.
 */
@Service
public class SettingsValidator {

	private static final LocalDate FIRST_GEE_DATE = LocalDate.of(2000, 1, 1);
	private static final int MIN_PORT = 1;
	private static final int MAX_PORT = 65535;

	private final SettingsModel model;
	/** Whether a folder is a Saiku server's (AnalysisSaikuService.isSaikuFolder) */
	private final Predicate<File> saikuFolder;
	private final Supplier<LocalDate> today;

	@Autowired
	public SettingsValidator(AnalysisSaikuService saiku) {
		this(new SettingsModel(), saiku::isSaikuFolder, LocalDate::now);
	}

	public SettingsValidator(SettingsModel model, Predicate<File> saikuFolder, Supplier<LocalDate> today) {
		this.model = model;
		this.saikuFolder = saikuFolder;
		this.today = today;
	}

	public SettingsModel getModel() {
		return model;
	}

	/** @param values every setting, by key, as the page holds them (the stored ones with the changes over them) */
	public Validation validate(Map<String, String> values) {
		Validation validation = new Validation();
		for (Setting setting : model.settings()) {
			if (setting.isVisible(values)) {
				check(setting, Condition.valueOf(values, setting.key()), values, validation);
			}
		}
		validation.plot(PlotGeometry.of(values));
		return validation;
	}

	private void check(Setting setting, String value, Map<String, String> values, Validation validation) {
		String key = setting.key();
		String trimmed = value.trim();
		if (setting.isRequired() && trimmed.isEmpty()) {
			validation.error(key, Messages.getString("PropertyValidators.required"));
			return;
		}
		switch (setting.getType()) {
		case INTEGER:
			if (!isWholeNumberWithin(trimmed, setting.getMin(), setting.getMax())) {
				validation.error(key, String.format(Messages.getString("PropertyValidators.valueRange"), setting.getMin(), setting.getMax()));
				return;
			}
			break;
		case DATE:
			if (!trimmed.isEmpty() && !isDateWithin(trimmed, FIRST_GEE_DATE, today.get())) {
				validation.error(key, Messages.getString("SettingsPage.date.invalid"));
				return;
			}
			break;
		default:
			break;
		}
		EarthProperty property = setting.getProperty();
		if (property == EarthProperty.HOST_PORT_KEY || property == EarthProperty.DB_PORT) {
			// Blank is allowed, as PortValidator allowed it: the default port is then used
			if (!trimmed.isEmpty() && !isWholeNumberWithin(trimmed, MIN_PORT, MAX_PORT)) {
				validation.error(key, Messages.getString("PropertyValidators.portRange"));
			}
		} else if (property == EarthProperty.DISTANCE_TO_BUFFERS) {
			checkReferenceDistance(key, values, validation);
		} else if (property == EarthProperty.EXTRA_MAP_URL) {
			checkExtraMapUrl(key, trimmed, validation);
		} else if (property == EarthProperty.GEEAPP_TO_DATE) {
			String from = Condition.valueOf(values, EarthProperty.GEEAPP_FROM_DATE.toString()).trim();
			if (!trimmed.isEmpty() && isDateWithin(from, FIRST_GEE_DATE, today.get()) && LocalDate.parse(from).isAfter(LocalDate.parse(trimmed))) {
				validation.error(key, Messages.getString("SettingsPage.date.order"));
			}
		} else if (property == EarthProperty.PLANET_MAPS_KEY) {
			if (trimmed.isEmpty()) {
				validation.warning(key, Messages.getString("OptionWizard.1055"));
			}
		} else if (property == EarthProperty.SAIKU_SERVER_FOLDER) {
			if (!trimmed.isEmpty() && !saikuFolder.test(new File(trimmed))) {
				validation.warning(key, Messages.getString("OptionWizard.27"));
			}
		}
	}

	/** The reference area must enclose the plot (an error), and should be about ten times its area (a warning). */
	private static void checkReferenceDistance(String key, Map<String, String> values, Validation validation) {
		PlotGeometry plot = PlotGeometry.of(values);
		int minimum = plot.minimumReferenceDistance();
		if (plot.getReferenceDistance() < minimum) {
			validation.error(key, MessageFormat.format(Messages.getString("OptionWizard.1025"), minimum));
		} else if (plot.isReferenceAreaSmall()) {
			validation.warning(key, Messages.getString("OptionWizard.1024"));
		}
	}

	/**
	 * The rules of UrlPlaceholderVerifier: a URL, with the placeholders Collect Earth replaces with the plot's values.
	 * Without them the same page opens for every plot, which is only a warning, as it was.
	 */
	private static void checkExtraMapUrl(String key, String url, Validation validation) {
		if (url.isEmpty()) {
			return;
		}
		try {
			new URL(url);
		} catch (MalformedURLException e) {
			validation.error(key, Messages.getString("SettingsPage.extraMap.invalid"));
			return;
		}
		boolean latitude = url.contains("LATITUDE");
		boolean longitude = url.contains("LONGITUDE");
		if (!latitude && !longitude && !url.contains("PLOT_ID") && !url.contains("GEOJSON")) {
			validation.warning(key, Messages.getString("SettingsPage.extraMap.noPlaceholder"));
		} else if (latitude != longitude) {
			validation.warning(key, Messages.getString("SettingsPage.extraMap.latLong"));
		}
	}

	private static boolean isWholeNumberWithin(String value, int min, int max) {
		try {
			int number = Integer.parseInt(value);
			return number >= min && number <= max;
		} catch (NumberFormatException e) {
			return false;
		}
	}

	private static boolean isDateWithin(String value, LocalDate first, LocalDate last) {
		try {
			LocalDate date = LocalDate.parse(value);
			return !date.isBefore(first) && !date.isAfter(last);
		} catch (DateTimeParseException e) {
			return false;
		}
	}
}

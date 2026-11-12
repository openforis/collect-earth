package org.openforis.collect.earth.app.service.settings;

import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.text.MessageFormat;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.function.Supplier;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudService;
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
	private final Supplier<LocalDate> today;
	/**
	 * In a cloud project, the folder of the plot files its server assigned to the operator (CloudService.downloadAssignment):
	 * the plots file can only be one of them. Null in a project kept on this computer.
	 */
	private final Supplier<File> assignedPlotFiles;
	/** The plots file in use, as stored: kept as it is, it is not refused (a project just joined has the one of its project file) */
	private final Supplier<String> plotFileInUse;

	@Autowired
	public SettingsValidator(LocalPropertiesService properties) {
		this(new SettingsModel(), LocalDate::now,
				() -> properties.isCloudSyncEnabled() ? CloudService.assignmentsFolderOf(properties.getImdFile()) : null,
				() -> properties.getValue(EarthProperty.SAMPLE_FILE));
	}

	/** A project kept on this computer: any plots file. */
	public SettingsValidator(SettingsModel model, Supplier<LocalDate> today) {
		this(model, today, () -> null, () -> "");
	}

	/**
	 * @param assignedPlotFiles the folder of the plot files assigned in the open cloud project, null for a local project
	 * @param plotFileInUse the plots file stored
	 */
	public SettingsValidator(SettingsModel model, Supplier<LocalDate> today, Supplier<File> assignedPlotFiles, Supplier<String> plotFileInUse) {
		this.model = model;
		this.today = today;
		this.assignedPlotFiles = assignedPlotFiles;
		this.plotFileInUse = plotFileInUse;
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
		if (property == EarthProperty.DB_PORT) {
			// Blank is allowed, as PortValidator allowed it: the default port is then used
			if (!trimmed.isEmpty() && !isWholeNumberWithin(trimmed, MIN_PORT, MAX_PORT)) {
				validation.error(key, Messages.getString("PropertyValidators.portRange"));
			}
		} else if (property == EarthProperty.DISTANCE_TO_BUFFERS) {
			checkReferenceDistance(key, values, validation);
		} else if (property == EarthProperty.SAMPLE_FILE) {
			checkAssignedPlotFile(key, trimmed, values, validation);
		} else if (property == EarthProperty.EXTRA_MAP_URL) {
			checkExtraMapUrl(key, trimmed, validation);
		} else if (property == EarthProperty.GEEAPP_TO_DATE) {
			String from = Condition.valueOf(values, EarthProperty.GEEAPP_FROM_DATE.toString()).trim();
			if (!trimmed.isEmpty() && isDateWithin(from, FIRST_GEE_DATE, today.get()) && LocalDate.parse(from).isAfter(LocalDate.parse(trimmed))) {
				validation.error(key, Messages.getString("SettingsPage.date.order"));
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
	 * In a cloud project the plots are the ones its coordinator assigned to the operator (whole files, or their share of a
	 * divided one, which the server serves with only their plots): the plots file can be changed only to one of the files
	 * downloaded from the server into the assignments folder (the list of the settings page), or kept as it is. Leaving the
	 * cloud project (another database) is not held back.
	 */
	private void checkAssignedPlotFile(String key, String path, Map<String, String> values, Validation validation) {
		File folder = assignedPlotFiles.get();
		if (folder == null || !CollectDBDriver.CLOUD.name().equals(Condition.valueOf(values, EarthProperty.DB_DRIVER.toString()).trim())) {
			return;
		}
		if (sameFile(path, StringUtils.trimToEmpty(plotFileInUse.get())) || isInside(path, folder)) {
			return;
		}
		validation.error(key, Messages.getString("SettingsPage.sampleFile.cloudAssigned"));
	}

	private static boolean sameFile(String path, String other) {
		if (path.isEmpty() || other.isEmpty()) {
			return path.equals(other);
		}
		return resolved(path).equals(resolved(other));
	}

	/** A file under the folder, as Collect Earth will read the path (LocalPropertiesService.getCsvFile turns its slashes) */
	static boolean isInside(String path, File folder) {
		if (path.isEmpty()) {
			return false;
		}
		File file = resolved(path);
		File root = resolved(folder.getPath());
		return !file.equals(root) && file.toPath().startsWith(root.toPath());
	}

	private static File resolved(String path) {
		File file = new File(path.replace('/', File.separatorChar).replace('\\', File.separatorChar));
		try {
			return file.getCanonicalFile();
		} catch (IOException e) {
			return file.getAbsoluteFile().toPath().normalize().toFile();
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

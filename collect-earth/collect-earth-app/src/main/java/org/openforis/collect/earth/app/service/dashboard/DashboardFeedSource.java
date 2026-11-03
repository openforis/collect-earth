package org.openforis.collect.earth.app.service.dashboard;

import java.io.File;
import java.io.IOException;
import java.util.List;

import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;

/**
 * What the local dashboard is fed from: the loaded project, its plot file and its records, as the cloud sync sends
 * them (CloudRecordSerializer). {@link EarthDashboardFeedSource} reads the desktop's own; the tests give theirs.
 */
public interface DashboardFeedSource {

	/** The survey's URI, or null while no survey is loaded. */
	String surveyUri();

	/** The project's name, shown by the dashboard. */
	String projectName();

	/** The person's name, as Collect Earth knows it (the operator of the settings). */
	String operator();

	/** The folder the project file was unpacked into, or null. */
	File projectFolder();

	/** The plot file in use, or null. */
	File plotFile();

	/** The ids of every record of the project, to load in turn with {@link #load(int)}. */
	List<Integer> recordIds();

	/** A record of {@link #recordIds()}, or null when it is gone. */
	RecordEnvelope load(int recordId) throws IOException;

	/** A record by its key (the key values joined by commas, as saves report it), or null when it is gone. */
	RecordEnvelope loadByKey(String recordKey) throws IOException;

	/**
	 * What, when it changes, means the dashboard has to start again: the survey, and the plot file's path, size and
	 * date.
	 */
	default String signature() {
		File plots = plotFile();
		File folder = projectFolder();
		return surveyUri() + "|" + (folder == null ? "" : folder.getAbsolutePath()) + "|" //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
				+ (plots == null ? "" : plots.getAbsolutePath() + "|" + plots.length() + "|" + plots.lastModified()); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
	}
}

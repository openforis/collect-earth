package org.openforis.collect.earth.app.service.jobs;

/** A long action the pages start and follow (an export, an import...): see JobService. */
@FunctionalInterface
public interface Job {
	/** @return what the page shows when it is done (a file written, a count), or null */
	Object run(JobContext context) throws Exception;
}

package org.openforis.collect.earth.app.service.dashboard;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.BatchResult;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.Destination;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Every record of a source sent through records:batch, a batch at a time: the local dashboard's initial feed, and the
 * sending of a project's records to its cloud project (CloudRecordsSender). The server keeps the newest version of each
 * record (last write wins), so sending a record again is harmless.
 */
public final class RecordBatches {

	/** What the server answered for the records sent. */
	public static final class Result {
		private int total;
		private int sent;
		private int refused;
		private long sendingMillis;
		private final Map<String, Integer> reasons = new LinkedHashMap<>();

		/** The records of the source, started or not. */
		public int getTotal() {
			return total;
		}

		/** Records the server has now: stored, or it had them already in the same or a newer version (stale). */
		public int getSent() {
			return sent;
		}

		/** Records the server refused, or that could not be read here. */
		public int getRefused() {
			return refused;
		}

		/** Why records were refused, with how many for each reason, in the order first seen. */
		public Map<String, Integer> getReasons() {
			return Collections.unmodifiableMap(reasons);
		}

		/** The time spent waiting for the server. */
		public long getSendingMillis() {
			return sendingMillis;
		}

		private void refuse(String reason) {
			refused++;
			reasons.merge(reason, 1, Integer::sum);
		}
	}

	/** Told after each batch: how many records of the source are done, of how many. */
	public interface Progress {
		void done(int done, int total);
	}

	private static final Logger logger = LoggerFactory.getLogger(RecordBatches.class);

	private RecordBatches() {
	}

	/**
	 * @param operator the operator each record is sent under, or null to keep the record's own
	 * @param stop     asked before each batch: true ends the sending with an IOException
	 * @throws IOException when a batch fails as a whole (the network, a refused sign-in): the batches before it stay sent
	 */
	public static Result upload(DashboardFeedSource source, CloudApiClient api, Destination target, String operator,
			int batchSize, BooleanSupplier stop, Progress progress) throws IOException {
		List<Integer> ids = source.recordIds();
		Result result = new Result();
		result.total = ids.size();
		for (int from = 0; from < ids.size(); from += batchSize) {
			if (stop.getAsBoolean()) {
				throw new IOException("Stopping"); //$NON-NLS-1$
			}
			int to = Math.min(ids.size(), from + batchSize);
			List<RecordEnvelope> envelopes = new ArrayList<>();
			for (Integer id : ids.subList(from, to)) {
				try {
					RecordEnvelope envelope = source.load(id);
					if (envelope != null) { // null: nothing answered in it, or gone
						envelopes.add(operator == null ? envelope : envelope.withOperator(operator));
					}
				} catch (IOException | RuntimeException e) {
					logger.debug("Record {} not sent: {}", id, e.getMessage()); //$NON-NLS-1$
					result.refuse(StringUtils.defaultIfBlank(e.getMessage(), e.getClass().getSimpleName()));
				}
			}
			if (!envelopes.isEmpty()) {
				long sending = System.currentTimeMillis();
				List<BatchResult> answers = api.uploadRecordsBatch(target, envelopes);
				result.sendingMillis += System.currentTimeMillis() - sending;
				Map<String, BatchResult> byKey = new HashMap<>();
				for (BatchResult answer : answers) {
					byKey.put(answer.getRecordKey(), answer);
				}
				for (RecordEnvelope envelope : envelopes) {
					BatchResult answer = byKey.get(envelope.getRecordKey());
					String status = answer == null ? null : answer.getStatus();
					if ("stored".equalsIgnoreCase(status) || "stale".equalsIgnoreCase(status)) { //$NON-NLS-1$ //$NON-NLS-2$
						result.sent++;
					} else {
						result.refuse(answer == null ? "no answer from the server" //$NON-NLS-1$
								: StringUtils.defaultIfBlank(answer.getReason(), StringUtils.defaultString(status)));
					}
				}
			}
			progress.done(to, ids.size());
		}
		return result;
	}
}

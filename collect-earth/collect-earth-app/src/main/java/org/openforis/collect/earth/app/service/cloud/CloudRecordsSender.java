package org.openforis.collect.earth.app.service.cloud;

import java.io.IOException;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.openforis.collect.earth.app.service.cloud.CloudService.InvalidCloudRequestException;
import org.openforis.collect.earth.app.service.dashboard.DashboardFeedSource;
import org.openforis.collect.earth.app.service.dashboard.EarthDashboardFeedSource;
import org.openforis.collect.earth.app.service.dashboard.RecordBatches;
import org.openforis.collect.earth.app.service.jobs.Job;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.stereotype.Component;

/**
 * Sends the records this computer has of the project to its cloud project: those collected before it joined (working
 * alone, or imported from other computers), which the sync's queue only holds once they are saved again. Every record
 * of the loaded survey goes, through records:batch; the server keeps the newest version of each, so sending again is
 * harmless. The loaded survey is the cloud project's: joining downloads and loads its project file.
 * <p>
 * The server stores records sent with a person's sign-in under that person's username, whoever the operator in them is.
 * So by default only the person's own records go: those under a name typed on this computer before it joined
 * ({@link #rememberLocalName}) or under their username. The records under other names (copied from colleagues'
 * computers) go only when the person asks for them too: they would count as theirs (docs/plans/2026-11-15-workflow-review.md).
 */
@Component
public class CloudRecordsSender implements ApplicationListener<ContextRefreshedEvent> {

	/** The notice's kind; the pages open the send dialog when its {@link #SEND} option is chosen */
	public static final String OFFER_NOTICE = "cloudSendRecords";
	public static final String SEND = "send";
	/** The sync's batch (CloudSyncService), what the server is sized for */
	static final int BATCH_SIZE = 50;

	private final Logger logger = LoggerFactory.getLogger(CloudRecordsSender.class);

	private final LocalPropertiesService properties;
	private final CloudApiClient api;
	private final DashboardFeedSource source;
	private final NoticeService notices;

	@Autowired
	public CloudRecordsSender(LocalPropertiesService properties, CloudApiClient api, EarthDashboardFeedSource source,
			@Autowired(required = false) NoticeService notices) {
		this(properties, api, (DashboardFeedSource) source, notices);
	}

	CloudRecordsSender(LocalPropertiesService properties, CloudApiClient api, DashboardFeedSource source, NoticeService notices) {
		this.properties = properties;
		this.api = api;
		this.source = source;
		this.notices = notices;
	}

	/** The first start after joining a cloud project: offers, once, to send the records this computer has. */
	@Override
	public void onApplicationEvent(ContextRefreshedEvent event) {
		if (!properties.isCloudSyncEnabled() || !Boolean.parseBoolean(properties.getValue(EarthProperty.CLOUD_OFFER_LOCAL_RECORDS))) {
			return;
		}
		properties.setValue(EarthProperty.CLOUD_OFFER_LOCAL_RECORDS, ""); // once: later, the Data menu has it
		try {
			Map<String, Object> local = localRecords();
			int count = (Integer) local.get("count"); //$NON-NLS-1$
			int others = (Integer) local.get("others"); //$NON-NLS-1$
			if (count > 0 && notices != null) {
				String others_ = others == 0 ? "" : "\n\n" + MessageFormat.format(Messages.getString("CloudSend.others"), others); //$NON-NLS-1$ //$NON-NLS-2$
				notices.post(new Notice(OFFER_NOTICE, Notice.INFO, Messages.getString("CloudSend.title"), //$NON-NLS-1$
						MessageFormat.format(Messages.getString("CloudSend.question"), count) + "\n\n" //$NON-NLS-1$ //$NON-NLS-2$
								+ MessageFormat.format(Messages.getString("CloudSend.underAccount"), properties.getOperator()) + others_) //$NON-NLS-1$
						.option("later", Messages.getString("CloudSend.later")) //$NON-NLS-1$ //$NON-NLS-2$
						.option(SEND, Messages.getString("CloudSend.send"))); //$NON-NLS-1$
			}
		} catch (IOException | RuntimeException e) {
			logger.warn("Could not offer to send the local records to the cloud project: {}", e.getMessage()); //$NON-NLS-1$
		}
	}

	/** The records of the loaded survey on this computer, those with nothing answered in them too. */
	public int localRecordCount() {
		return source.recordIds().size();
	}

	/** Remembers a name typed on this computer as the person's own (at a join), with those remembered before. */
	public static void rememberLocalName(LocalPropertiesService properties, String name) {
		String typed = StringUtils.trimToNull(name);
		if (typed == null) {
			return;
		}
		Set<String> names = new LinkedHashSet<>(localNames(properties));
		names.add(typed);
		properties.setValue(EarthProperty.CLOUD_LOCAL_NAMES, String.join("\n", names));
	}

	/** The names typed on this computer before it joined (one per line) */
	static List<String> localNames(LocalPropertiesService properties) {
		String stored = StringUtils.defaultString(properties.getValue(EarthProperty.CLOUD_LOCAL_NAMES));
		List<String> names = new ArrayList<>();
		for (String line : stored.split("\n")) {
			if (StringUtils.isNotBlank(line)) {
				names.add(line.trim());
			}
		}
		return names;
	}

	/** Whether a record's operator is this person: a name typed here before the join, or their username (any letter case) */
	boolean isMine(String operator) {
		String o = StringUtils.trimToEmpty(operator);
		if (o.equalsIgnoreCase(StringUtils.trimToEmpty(properties.getOperator()))) {
			return true;
		}
		return localNames(properties).stream().anyMatch(o::equalsIgnoreCase);
	}

	/**
	 * The records of the project on this computer: how many in all, how many are the person's ({@link #isMine}), and the
	 * names typed here before the join, for the page to say.
	 */
	public Map<String, Object> localRecords() throws IOException {
		int mine = 0;
		int others = 0;
		for (Integer id : source.recordIds()) {
			RecordEnvelope envelope = source.load(id);
			if (envelope == null) {
				continue;
			}
			if (isMine(envelope.getOperator())) {
				mine++;
			} else {
				others++;
			}
		}
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("count", mine + others);
		answer.put("mine", mine);
		answer.put("others", others);
		answer.put("names", localNames(properties));
		return answer;
	}

	/** The source with only the person's records (the others are skipped as records with nothing in them are) */
	DashboardFeedSource onlyMine() {
		CloudRecordsSender sender = this;
		return new DashboardFeedSource() {
			@Override
			public String surveyUri() {
				return source.surveyUri();
			}

			@Override
			public String projectName() {
				return source.projectName();
			}

			@Override
			public String operator() {
				return source.operator();
			}

			@Override
			public java.io.File projectFolder() {
				return source.projectFolder();
			}

			@Override
			public java.io.File plotFile() {
				return source.plotFile();
			}

			@Override
			public List<Integer> recordIds() {
				List<Integer> ids = new ArrayList<>();
				for (Integer id : source.recordIds()) {
					try {
						RecordEnvelope envelope = source.load(id);
						if (envelope == null || sender.isMine(envelope.getOperator())) {
							ids.add(id);
						}
					} catch (IOException e) {
						ids.add(id); // said as refused when it is sent
					}
				}
				return ids;
			}

			@Override
			public RecordEnvelope load(int recordId) throws IOException {
				return source.load(recordId);
			}

			@Override
			public RecordEnvelope loadByKey(String recordKey) throws IOException {
				return source.loadByKey(recordKey);
			}
		};
	}

	/**
	 * The job sending them, once the project is a cloud project one is signed in to. Its result: total, sent, refused,
	 * and the reasons of the refusals with their counts.
	 */
	public Job sendJob() throws InvalidCloudRequestException {
		return sendJob(false);
	}

	/** {@link #sendJob()}: the person's records only, or ({@code all}) those under other names too. */
	public Job sendJob(boolean all) throws InvalidCloudRequestException {
		if (!properties.isCloudSyncEnabled() || StringUtils.isBlank(properties.getCloudSyncUrl())
				|| StringUtils.isBlank(properties.getCloudProjectId())) {
			throw new InvalidCloudRequestException("cloud.notConnected", Messages.getString("CloudSend.notConnected")); //$NON-NLS-1$ //$NON-NLS-2$
		}
		if (StringUtils.isBlank(properties.getCloudSyncToken())) {
			throw new InvalidCloudRequestException("cloud.notSignedIn", Messages.getString("CloudSend.notSignedIn")); //$NON-NLS-1$ //$NON-NLS-2$
		}
		if (source.surveyUri() == null) {
			throw new InvalidCloudRequestException("cloud.noSurvey", Messages.getString("CloudSend.noSurvey")); //$NON-NLS-1$ //$NON-NLS-2$
		}
		return context -> {
			context.progress(0, Messages.getString("CloudSend.sending")); //$NON-NLS-1$
			RecordBatches.Result result = RecordBatches.upload(all ? source : onlyMine(), api, api.cloudDestination(), null, BATCH_SIZE,
					context::isCancelled, (done, total) -> context.progress(done * 100 / total,
							MessageFormat.format(Messages.getString("CloudSend.progress"), done, total))); //$NON-NLS-1$
			List<Map<String, Object>> reasons = new ArrayList<>();
			result.getReasons().forEach((reason, count) -> {
				context.message(reason + ": " + count); //$NON-NLS-1$
				Map<String, Object> entry = new LinkedHashMap<>();
				entry.put("reason", reason); //$NON-NLS-1$
				entry.put("count", count); //$NON-NLS-1$
				reasons.add(entry);
			});
			logger.info("Sent the local records to the cloud project: {} of {}, {} refused", result.getSent(), //$NON-NLS-1$
					result.getTotal(), result.getRefused());
			Map<String, Object> answer = new LinkedHashMap<>();
			answer.put("total", result.getTotal()); //$NON-NLS-1$
			answer.put("sent", result.getSent()); //$NON-NLS-1$
			answer.put("refused", result.getRefused()); //$NON-NLS-1$
			answer.put("reasons", reasons); //$NON-NLS-1$
			return answer;
		};
	}
}

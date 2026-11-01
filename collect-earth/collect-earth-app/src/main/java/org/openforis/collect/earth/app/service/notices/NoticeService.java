package org.openforis.collect.earth.app.service.notices;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import org.springframework.stereotype.Component;

/**
 * The notices the pages have not answered yet (see Notice), oldest first: the pages poll them and show the first.
 * Answering one takes it out and runs what its option does on the server (the updater, the build to ignore, the
 * announcement marked as read).
 */
@Component
public class NoticeService {

	private static final class Pending {
		final Notice notice;
		final Consumer<String> answerer;

		Pending(Notice notice, Consumer<String> answerer) {
			this.notice = notice;
			this.answerer = answerer;
		}
	}

	private final Map<String, Pending> pending = new LinkedHashMap<>();
	private int sequence;

	/** @return the id the page answers by */
	public synchronized String post(Notice notice) {
		return post(notice, null);
	}

	/**
	 * @param answerer what to do with the option chosen, or null when nothing is to be done; it runs on the thread that
	 *        answers, outside the lock
	 */
	public synchronized String post(Notice notice, Consumer<String> answerer) {
		String id = "n" + (++sequence);
		pending.put(id, new Pending(notice, answerer));
		return id;
	}

	public synchronized List<Map<String, Object>> pending() {
		List<Map<String, Object>> list = new ArrayList<>();
		for (Map.Entry<String, Pending> entry : pending.entrySet()) {
			list.add(entry.getValue().notice.toJson(entry.getKey()));
		}
		return list;
	}

	/** Whether a notice of the kind is waiting for an answer */
	public synchronized boolean hasPending(String kind) {
		for (Pending p : pending.values()) {
			if (p.notice.getKind().equals(kind)) {
				return true;
			}
		}
		return false;
	}

	/** @return false when there is no such notice (answered already, or by another page) */
	public boolean answer(String id, String option) {
		Pending answered;
		synchronized (this) {
			answered = pending.remove(id);
		}
		if (answered == null) {
			return false;
		}
		if (answered.answerer != null) {
			answered.answerer.accept(option);
		}
		return true;
	}
}

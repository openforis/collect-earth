package org.openforis.collect.earth.app.service.notices;

import java.text.MessageFormat;
import java.util.concurrent.atomic.AtomicBoolean;

import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.SafetyCopy;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.stereotype.Component;

/**
 * Tells the person, once, at the start after it was taken, where a safety copy of their data is (SafetyCopy): the one
 * of Collect Earth 1's data at the first start of Collect Earth 2, or the one of a project a cloud project replaced.
 */
// Not lazy: nothing asks for this bean
@Component
@Lazy(false)
public class SafetyCopyNotice implements ApplicationListener<ContextRefreshedEvent> {

	public static final String KIND = "safetyCopy"; //$NON-NLS-1$

	private final AtomicBoolean told = new AtomicBoolean(false);

	@Autowired
	private LocalPropertiesService properties;

	@Autowired
	private NoticeService notices;

	@Override
	public void onApplicationEvent(ContextRefreshedEvent event) {
		if (!told.compareAndSet(false, true)) {
			return; // refreshed twice (the root context and the DispatcherServlet's)
		}
		Notice notice = noticeOf(SafetyCopy.pendingNotice(properties));
		if (notice != null) {
			notices.post(notice);
		}
	}

	/** The notice of a pending copy ({kind, path, project}), or null */
	static Notice noticeOf(String[] pending) {
		if (pending == null) {
			return null;
		}
		String message = SafetyCopy.BEFORE_JOIN.equals(pending[0])
				? MessageFormat.format(Messages.getString("SafetyCopy.beforeJoin"), pending[1], pending[2]) //$NON-NLS-1$
				: MessageFormat.format(Messages.getString("SafetyCopy.firstStart"), pending[1]); //$NON-NLS-1$
		return new Notice(KIND, Notice.INFO, Messages.getString("SafetyCopy.title"), message); //$NON-NLS-1$
	}
}

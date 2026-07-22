/*
 * earth_web.js — modern (Bootstrap 5 + vanilla ES6) client for the Collect Earth
 * web balloon used by the Leaflet viewer.
 *
 * It is a pure client of the existing Collect Earth endpoints, preserving the
 * legacy wire protocol exactly (see earthFiles/js/earth_new.js for the GEP-era
 * reference this replaces):
 *   - load:  GET  {HOST}placemark-info-expanded?id={comma-joined key attributes}
 *   - save:  POST {HOST}save-data-expanded   (application/x-www-form-urlencoded)
 *            body: placemarkId, values[<encoded name>]=<value>, currentStep, partialUpdate=true
 *
 * Field value conventions (identical to legacy):
 *   - multi-values joined with "==="
 *   - booleans "true"/"false"
 *   - coordinates "longitude,latitude" (kept verbatim from the $[...] token)
 *   - collect_boolean_actively_saved: "false" on autosave, "true" on Submit
 *
 * SECURITY: never assigns server-provided data through innerHTML. All dynamic
 * text is written with document.createElement / textContent only.
 */
(function () {
	'use strict';

	/* ------------------------------------------------------------------ *
	 * Configuration (injected by balloon_web.html via $[...] tokens)
	 * ------------------------------------------------------------------ */
	var HOST = (typeof window.HOST === 'string') ? window.HOST : '';
	var EXTRA_ID_ATTRIBUTES = Array.isArray(window.EXTRA_ID_ATTRIBUTES)
		? window.EXTRA_ID_ATTRIBUTES
		: ['collect_text_id'];

	var LOAD_URL = HOST + 'placemark-info-expanded';
	var SAVE_URL = HOST + 'save-data-expanded';

	var SEP_MULTI = '==='; // separator for multiple attribute values
	var ACTIVELY_SAVED_FIELD = 'collect_boolean_actively_saved';
	var AUTOSAVE_DELAY = 1000; // 1s debounce
	var REQUEST_TIMEOUT = 10000;
	var TARGET_ORIGIN = window.location.origin;

	/* ------------------------------------------------------------------ *
	 * Static option lists (identical values/labels to the legacy balloon)
	 * ------------------------------------------------------------------ */
	var COVERAGE_OPTIONS = [
		{ v: 'na', l: '0 Points – No Coverage' },
		{ v: '2', l: '1 Points' }, { v: '4', l: '2 Points' }, { v: '6', l: '3 Points' },
		{ v: '8', l: '4 Points' }, { v: '10', l: '5-9 Points' }, { v: '20', l: '10-14 Points' },
		{ v: '30', l: '15-19 Points' }, { v: '40', l: '20-24 Points' }, { v: '50', l: '25-29 Points' },
		{ v: '60', l: '30-34 Points' }, { v: '70', l: '35-39 Points' }, { v: '80', l: '40-44 Points' },
		{ v: '90', l: '45-49 Points' }
	];

	function buildYearOptions() {
		var opts = [{ v: '', l: 'Nothing selected' }];
		for (var y = 2025; y >= 2000; y--) {
			opts.push({ v: String(y), l: String(y) });
		}
		return opts;
	}
	var YEAR_OPTIONS = buildYearOptions();

	/* ------------------------------------------------------------------ *
	 * Mutable state
	 * ------------------------------------------------------------------ */
	var form = null;
	var stepEls = [];
	var pillEls = [];
	var currentStepIndex = 0;
	var stateByFieldName = {}; // last known server field info
	var autosaveTimer = null;
	var dirtyMessageSent = false;
	var loadedOnce = false;
	var suppressChange = false; // true while programmatically filling the form

	/* ------------------------------------------------------------------ *
	 * Small DOM helpers
	 * ------------------------------------------------------------------ */
	function byId(id) { return document.getElementById(id); }
	function fieldByName(name) { return form.querySelector('[name="' + name + '"]'); }
	function allCollectFields() { return form.querySelectorAll('[name^="collect_"]'); }
	function fieldWrapper(el) { return el.closest('.ce-field'); }

	function clearChildren(node) {
		while (node.firstChild) { node.removeChild(node.firstChild); }
	}

	/* ------------------------------------------------------------------ *
	 * Placemark id & serialization
	 * ------------------------------------------------------------------ */
	function getPlacemarkId() {
		var parts = [];
		for (var i = 0; i < EXTRA_ID_ATTRIBUTES.length; i++) {
			var el = fieldByName(EXTRA_ID_ATTRIBUTES[i]);
			parts.push(el ? el.value : '');
		}
		return parts.join(',');
	}

	// Collect current values of every collect_* named element (incl. disabled
	// calculated / extra fields, matching the legacy partial-update payload).
	function serializeValues() {
		var values = {};
		var fields = allCollectFields();
		for (var i = 0; i < fields.length; i++) {
			var el = fields[i];
			var name = el.getAttribute('name');
			if (name.indexOf('$index') >= 0) { continue; } // skip template placeholders
			values[name] = el.value != null ? el.value : '';
		}
		return values;
	}

	// Build the x-www-form-urlencoded body, replicating jQuery's deep
	// serialization: values[<encodeURIComponent(name)>]=value. The server
	// URL-decodes the map key back to the real field name.
	function buildBody(activelySaved) {
		var savedEl = fieldByName(ACTIVELY_SAVED_FIELD);
		if (savedEl) { savedEl.value = activelySaved ? 'true' : 'false'; }

		var params = new URLSearchParams();
		params.append('placemarkId', getPlacemarkId());
		params.append('currentStep', String(currentStepIndex));
		params.append('partialUpdate', 'true');

		var values = serializeValues();
		for (var name in values) {
			if (Object.prototype.hasOwnProperty.call(values, name)) {
				params.append('values[' + encodeURIComponent(name) + ']', values[name]);
			}
		}
		return params;
	}

	/* ------------------------------------------------------------------ *
	 * Networking (fetch with timeout)
	 * ------------------------------------------------------------------ */
	function fetchWithTimeout(url, options) {
		options = options || {};
		var controller = new AbortController();
		options.signal = controller.signal;
		var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT);
		return fetch(url, options).finally(function () { clearTimeout(timer); });
	}

	/* ------------------------------------------------------------------ *
	 * Save-state pill
	 * ------------------------------------------------------------------ */
	function setSaveState(state) {
		var pill = byId('ceSavePill');
		var text = byId('ceSaveText');
		if (!pill || !text) { return; }
		pill.className = 'ce-save-pill ce-save-' + state;
		var labels = { idle: 'Idle', unsaved: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', error: 'Save failed' };
		text.textContent = labels[state] || state;
	}

	function showServerWarning(show) {
		var w = byId('ceServerWarning');
		if (w) { w.style.display = show ? 'flex' : 'none'; }
	}

	/* ------------------------------------------------------------------ *
	 * postMessage to the parent map page
	 * ------------------------------------------------------------------ */
	function postToParent(type) {
		if (window.parent === window) { return; }
		try {
			window.parent.postMessage({ type: type, plotId: getPlacemarkId() }, TARGET_ORIGIN);
		} catch (e) { /* ignore */ }
	}

	/* ------------------------------------------------------------------ *
	 * Load
	 * ------------------------------------------------------------------ */
	function loadPlacemark(reloadingAfterError) {
		showServerWarning(false);
		if (!loadedOnce) { showPanel('loading'); }
		var url = LOAD_URL + '?id=' + encodeURIComponent(getPlacemarkId());

		fetchWithTimeout(url, { method: 'GET', headers: { 'Accept': 'application/json' } })
			.then(function (resp) { return resp.json(); })
			.then(function (json) { handleLoadResponse(json); })
			.catch(function () {
				// Server unreachable / aborted
				setSaveState('error');
				showServerWarning(true);
				if (!loadedOnce) { showPanel('loading'); }
			});
	}

	function handleLoadResponse(json) {
		if (json && json.success) {
			var idInfo = json.inputFieldInfoByParameterName
				? json.inputFieldInfoByParameterName.collect_text_id : null;
			var alreadyFilled = json.activelySaved && idInfo && idInfo.value !== 'testPlacemark';

			// Apply the server data to the form (no validation popups on load).
			applyResponse(json, false);
			currentStepIndex = parseIntOr(json.currentStep, 0);
			loadedOnce = true;

			if (alreadyFilled) {
				buildFilledSummary();
				showPanel('filled');
			} else {
				showPanel('form');
				showStep(currentStepIndex);
			}
			setSaveState(json.activelySaved ? 'saved' : 'idle');
		} else {
			// No record yet: force the creation of a new one (autosave false).
			save(false);
		}
	}

	/* ------------------------------------------------------------------ *
	 * Save / autosave / submit
	 * ------------------------------------------------------------------ */
	function scheduleAutosave() {
		if (autosaveTimer) { clearTimeout(autosaveTimer); }
		setSaveState('unsaved');
		if (!dirtyMessageSent) {
			dirtyMessageSent = true;
			postToParent('ce:dirty');
		}
		autosaveTimer = setTimeout(function () { save(false); }, AUTOSAVE_DELAY);
	}

	function save(activelySaved) {
		if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
		setSaveState('saving');
		var body = buildBody(activelySaved);

		fetchWithTimeout(SAVE_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Accept': 'application/json' },
			body: body.toString()
		})
			.then(function (resp) { return resp.json(); })
			.then(function (json) {
				showServerWarning(false);
				if (json && json.success) {
					handleSaveSuccess(json, activelySaved);
				} else {
					setSaveState('error');
					if (activelySaved) { showInlineError(json && json.message ? json.message : 'The data could not be saved.'); }
				}
			})
			.catch(function () {
				setSaveState('error');
				showServerWarning(true);
			});
	}

	function handleSaveSuccess(json, activelySaved) {
		applyResponse(json, activelySaved);

		if (activelySaved) {
			if (isAnyErrorInForm()) {
				// Validation failed: stay on the form, surface the errors, and
				// reset the actively-saved flag so a later autosave is not
				// mistaken for a resubmit.
				var savedEl = fieldByName(ACTIVELY_SAVED_FIELD);
				if (savedEl) { savedEl.value = 'false'; }
				setSaveState('error');
				goToFirstErrorStep();
			} else {
				setSaveState('saved');
				postToParent('ce:saved');
			}
		} else {
			setSaveState('saved');
		}
	}

	/* ------------------------------------------------------------------ *
	 * Apply a server response to the form
	 * ------------------------------------------------------------------ */
	function applyResponse(json, showValidation) {
		var infos = json.inputFieldInfoByParameterName || {};
		// 1. cache
		for (var name in infos) {
			if (Object.prototype.hasOwnProperty.call(infos, name)) {
				stateByFieldName[name] = infos[name];
			}
		}
		// 2. parent-child code lists (needs the full cache)
		updateHierarchies(infos);
		// 3. fill values
		suppressChange = true;
		for (var fName in infos) {
			if (Object.prototype.hasOwnProperty.call(infos, fName)) {
				var el = fieldByName(fName);
				if (el) { setFieldValue(el, infos[fName].value); }
			}
		}
		suppressChange = false;
		// 4. validation + relevance
		applyValidationAndRelevance(infos);
		// 5. per-step error badges
		updateStepBadges();
		// 6. operator, if the server reports one
		updateOperator(infos);
	}

	function updateOperator(infos) {
		var info = infos.collect_text_operator;
		var el = byId('ceOperator');
		if (el && info && info.value) {
			el.textContent = 'Operator: ' + info.value;
			el.style.display = '';
		}
	}

	function updateHierarchies(infos) {
		// For every child code field, refresh its options/visible subset from the
		// parent's coded value (parent info comes from the server, even for
		// calculated fields not rendered in the form).
		var childInputs = form.querySelectorAll('[data-parent-id-field-id]');
		for (var i = 0; i < childInputs.length; i++) {
			var input = childInputs[i];
			var parentName = input.getAttribute('data-parent-id-field-id');
			var parentInfo = stateByFieldName[parentName];
			var fieldType = input.getAttribute('data-field-type');
			if (fieldType === 'CODE_SELECT') {
				populateChildSelect(input, infos[input.getAttribute('name')]);
			} else if (fieldType === 'CODE_BUTTON_GROUP') {
				var parentCodeItemId = parentInfo ? parentInfo.codeItemId : null;
				showButtonSubset(input, parentCodeItemId);
			}
		}
	}

	// CODE_SELECT children get their <option> set from possibleCodedItems.
	function populateChildSelect(select, info) {
		var items = (info && info.possibleCodedItems) ? info.possibleCodedItems : [];
		var oldValue = select.value;
		clearChildren(select);
		var placeholder = document.createElement('option');
		placeholder.value = '';
		placeholder.textContent = 'Nothing selected';
		select.appendChild(placeholder);
		for (var i = 0; i < items.length; i++) {
			var opt = document.createElement('option');
			opt.value = items[i].code;
			opt.textContent = items[i].label != null ? items[i].label : items[i].code;
			select.appendChild(opt);
		}
		select.value = oldValue;
		if (select.value == null || select.selectedIndex < 0) { select.selectedIndex = 0; }
	}

	// CODE_BUTTON_GROUP children: show only the .code-items subset whose
	// data-parent-id matches the parent's selected code item id.
	function showButtonSubset(input, parentCodeItemId) {
		var group = input.closest('.code-items-group');
		if (!group) { return; }
		var subsets = group.querySelectorAll('.code-items[data-parent-id]');
		for (var i = 0; i < subsets.length; i++) {
			var match = parentCodeItemId != null &&
				String(subsets[i].getAttribute('data-parent-id')) === String(parentCodeItemId);
			subsets[i].style.display = match ? 'flex' : 'none';
		}
	}

	function applyValidationAndRelevance(infos) {
		for (var name in infos) {
			if (!Object.prototype.hasOwnProperty.call(infos, name)) { continue; }
			var info = infos[name];
			var el = fieldByName(name);
			if (!el) { continue; }
			var wrapper = fieldWrapper(el);
			if (wrapper) {
				// relevance
				wrapper.classList.toggle('notrelevant', !info.visible);
				// validation
				var inError = !!info.inError && info.visible;
				wrapper.classList.toggle('is-invalid', inError);
				var fb = wrapper.querySelector('.ce-invalid-feedback, .invalid-feedback');
				if (fb) { fb.textContent = inError ? (info.errorMessage || 'Invalid value') : ''; }
			}
		}
	}

	function isAnyErrorInForm() {
		for (var name in stateByFieldName) {
			if (Object.prototype.hasOwnProperty.call(stateByFieldName, name)) {
				var info = stateByFieldName[name];
				if (info && info.visible && info.inError) { return true; }
			}
		}
		return false;
	}

	/* ------------------------------------------------------------------ *
	 * Setting field values by type (mirrors legacy setValueInInputField)
	 * ------------------------------------------------------------------ */
	function setFieldValue(el, value) {
		var tag = el.tagName;
		var fieldType = el.getAttribute('data-field-type');
		if (tag === 'SELECT') {
			el.value = value != null ? value : '';
			if (el.selectedIndex < 0) { el.selectedIndex = 0; }
			return;
		}
		if (tag === 'TEXTAREA') { el.value = value != null ? value : ''; return; }
		// INPUT
		el.value = value != null ? value : '';
		if (fieldType === 'BOOLEAN') {
			var bgroup = el.closest('.boolean-group');
			if (bgroup) {
				deactivate(bgroup.querySelectorAll('button'));
				if (value) { activateByValue(bgroup, value); }
			}
		} else if (fieldType === 'CODE_BUTTON_GROUP') {
			var cgroup = el.closest('.code-items-group');
			if (cgroup) {
				deactivate(cgroup.querySelectorAll('.code-item'));
				if (value) {
					var visible = getVisibleSubset(cgroup);
					var container = visible || cgroup;
					var parts = String(value).split(SEP_MULTI);
					for (var i = 0; i < parts.length; i++) {
						var btn = container.querySelector('.code-item[value="' + cssEscapeValue(parts[i]) + '"]');
						if (btn) { btn.classList.add('active'); }
					}
				}
			}
		}
	}

	function getVisibleSubset(group) {
		var subsets = group.querySelectorAll('.code-items');
		for (var i = 0; i < subsets.length; i++) {
			if (subsets[i].style.display !== 'none') { return subsets[i]; }
		}
		return subsets.length ? subsets[0] : null;
	}

	function deactivate(nodeList) {
		for (var i = 0; i < nodeList.length; i++) { nodeList[i].classList.remove('active'); }
	}
	function activateByValue(group, value) {
		var btns = group.querySelectorAll('button');
		for (var i = 0; i < btns.length; i++) {
			if (btns[i].value === value) { btns[i].classList.add('active'); }
		}
	}
	function cssEscapeValue(v) { return String(v).replace(/["\\]/g, '\\$&'); }

	/* ------------------------------------------------------------------ *
	 * Input wiring
	 * ------------------------------------------------------------------ */
	function wireInputs() {
		// plain inputs / selects / textareas
		var fields = allCollectFields();
		for (var i = 0; i < fields.length; i++) {
			var el = fields[i];
			var tag = el.tagName;
			if (tag === 'SELECT') {
				el.addEventListener('change', onUserChange);
			} else if (tag === 'TEXTAREA' || (tag === 'INPUT' && el.type !== 'hidden')) {
				el.addEventListener('change', onUserChange);
				el.addEventListener('input', onUserChange);
			}
		}
		// code-item buttons (single/multiple select) + boolean buttons
		var buttons = form.querySelectorAll('.code-items .code-item, .boolean-group button');
		for (var b = 0; b < buttons.length; b++) {
			buttons[b].addEventListener('click', onButtonClick);
		}
	}

	function onUserChange() {
		if (suppressChange) { return; }
		scheduleAutosave();
	}

	function onButtonClick(event) {
		event.preventDefault();
		var btn = event.currentTarget;
		var boolGroup = btn.closest('.boolean-group');
		if (boolGroup) {
			handleBooleanClick(boolGroup, btn);
		} else {
			handleCodeItemClick(btn);
		}
		if (!suppressChange) { scheduleAutosave(); }
		return false;
	}

	function handleBooleanClick(group, btn) {
		var hidden = group.querySelector('input[type="hidden"]');
		var wasActive = btn.classList.contains('active');
		deactivate(group.querySelectorAll('button'));
		if (!wasActive) {
			btn.classList.add('active');
			hidden.value = btn.value;
		} else {
			hidden.value = '';
		}
	}

	function handleCodeItemClick(btn) {
		var itemsContainer = btn.closest('.code-items');
		var group = btn.closest('.code-items-group');
		var hidden = group.querySelector('input[type="hidden"]');
		var multiple = itemsContainer.getAttribute('data-toggle') === 'buttons';
		var wasActive = btn.classList.contains('active');

		if (multiple) {
			btn.classList.toggle('active', !wasActive);
			var actives = itemsContainer.querySelectorAll('.code-item.active');
			var parts = [];
			for (var i = 0; i < actives.length; i++) { parts.push(actives[i].value); }
			hidden.value = parts.join(SEP_MULTI);
		} else {
			// single selection (buttons-radio)
			deactivate(itemsContainer.querySelectorAll('.code-item'));
			if (!wasActive) {
				btn.classList.add('active');
				hidden.value = btn.value;
			} else {
				hidden.value = '';
			}
		}

		// Instant child refresh when this field is a rendered parent of a
		// hierarchical child (server response will reconcile authoritatively).
		refreshChildrenOfParent(hidden.getAttribute('name'), wasActive ? null : btn.getAttribute('data-code-item-id'));
	}

	function refreshChildrenOfParent(parentName, codeItemId) {
		var children = form.querySelectorAll('[data-parent-id-field-id="' + parentName + '"]');
		for (var i = 0; i < children.length; i++) {
			if (children[i].getAttribute('data-field-type') === 'CODE_BUTTON_GROUP') {
				showButtonSubset(children[i], codeItemId);
			}
		}
	}

	/* ------------------------------------------------------------------ *
	 * Static option population
	 * ------------------------------------------------------------------ */
	function populateStaticSelects() {
		fillSelects(form.querySelectorAll('.coverage-select'), COVERAGE_OPTIONS);
		fillSelects(form.querySelectorAll('.year-select'), YEAR_OPTIONS);
	}
	function fillSelects(nodeList, options) {
		for (var i = 0; i < nodeList.length; i++) {
			var select = nodeList[i];
			clearChildren(select);
			for (var j = 0; j < options.length; j++) {
				var opt = document.createElement('option');
				opt.value = options[j].v;
				opt.textContent = options[j].l;
				select.appendChild(opt);
			}
		}
	}

	/* ------------------------------------------------------------------ *
	 * Stepper
	 * ------------------------------------------------------------------ */
	function buildStepper() {
		stepEls = Array.prototype.slice.call(form.querySelectorAll('.ce-step'));
		var pillList = byId('ceStepPills');
		clearChildren(pillList);
		pillEls = [];
		stepEls.forEach(function (step, index) {
			var li = document.createElement('li');
			li.className = 'nav-item';
			var a = document.createElement('button');
			a.type = 'button';
			a.className = 'nav-link';
			var label = document.createElement('span');
			label.textContent = step.getAttribute('data-step-short') || ('Step ' + (index + 1));
			a.appendChild(label);
			var badge = document.createElement('span');
			badge.className = 'ce-step-badge';
			a.appendChild(badge);
			a.addEventListener('click', function () { showStep(index); });
			li.appendChild(a);
			pillList.appendChild(li);
			pillEls.push({ link: a, badge: badge });
		});

		byId('cePrevBtn').addEventListener('click', function () { showStep(currentStepIndex - 1); });
		byId('ceNextBtn').addEventListener('click', function () { showStep(currentStepIndex + 1); });
	}

	function showStep(index) {
		if (index < 0) { index = 0; }
		if (index > stepEls.length - 1) { index = stepEls.length - 1; }
		currentStepIndex = index;
		stepEls.forEach(function (step, i) { step.classList.toggle('active', i === index); });
		pillEls.forEach(function (p, i) { p.link.classList.toggle('active', i === index); });

		var prevBtn = byId('cePrevBtn');
		var nextBtn = byId('ceNextBtn');
		prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
		nextBtn.style.visibility = index === stepEls.length - 1 ? 'hidden' : 'visible';

		if (stepEls[index].classList.contains('ce-review-step')) { buildReviewSummary(); }
	}

	function goToFirstErrorStep() {
		for (var i = 0; i < stepEls.length; i++) {
			if (stepEls[i].querySelector('.ce-field.is-invalid')) { showStep(i); return; }
		}
	}

	function updateStepBadges() {
		stepEls.forEach(function (step, i) {
			var count = step.querySelectorAll('.ce-field.is-invalid').length;
			var p = pillEls[i];
			if (!p) { return; }
			if (count > 0) {
				p.badge.textContent = String(count);
				p.badge.classList.add('show');
				p.link.classList.remove('ce-done');
			} else {
				p.badge.classList.remove('show');
				var hasValues = stepHasEnteredValues(step);
				p.link.classList.toggle('ce-done', hasValues);
			}
		});
	}

	function stepHasEnteredValues(step) {
		var fields = step.querySelectorAll('[name^="collect_"]');
		for (var i = 0; i < fields.length; i++) {
			if (fields[i].value && fields[i].value !== 'na' && fields[i].value !== '0') { return true; }
		}
		return false;
	}

	/* ------------------------------------------------------------------ *
	 * Summaries (review step + already-filled card)
	 * ------------------------------------------------------------------ */
	function buildReviewSummary() { renderSummaryInto(byId('ceReviewSummary')); }
	function buildFilledSummary() { renderSummaryInto(byId('ceFilledSummary')); }

	function renderSummaryInto(container) {
		if (!container) { return; }
		clearChildren(container);
		var rows = 0;
		for (var s = 0; s < stepEls.length; s++) {
			if (stepEls[s].classList.contains('ce-review-step')) { continue; }
			var fields = stepEls[s].querySelectorAll('[name^="collect_"]');
			for (var i = 0; i < fields.length; i++) {
				var el = fields[i];
				var wrapper = fieldWrapper(el);
				if (wrapper && wrapper.classList.contains('notrelevant')) { continue; }
				var value = el.value;
				if (!value || value === 'na') { continue; }
				var display = displayValueFor(el, value);
				if (!display) { continue; }
				container.appendChild(makeSummaryRow(labelFor(el), display));
				rows++;
			}
		}
		if (rows === 0) {
			var empty = document.createElement('div');
			empty.className = 'ce-summary-empty';
			empty.textContent = 'No values entered yet.';
			container.appendChild(empty);
		}
	}

	function makeSummaryRow(label, value) {
		var row = document.createElement('div');
		row.className = 'ce-summary-row';
		var l = document.createElement('span');
		l.className = 'ce-summary-label';
		l.textContent = label;
		var v = document.createElement('span');
		v.className = 'ce-summary-value';
		v.textContent = value;
		row.appendChild(l);
		row.appendChild(v);
		return row;
	}

	function labelFor(el) {
		var wrapper = fieldWrapper(el);
		if (wrapper) {
			var lbl = wrapper.querySelector('.form-label');
			if (lbl) { return cleanLabel(lbl); }
		}
		// entity table cell: use the row's first cell as the label
		var tr = el.closest('tr');
		if (tr && tr.firstElementChild) {
			var section = el.closest('.ce-card');
			var prefix = '';
			if (section) {
				var st = section.querySelector('.ce-section-title');
				if (st) { prefix = st.textContent.trim() + ' — '; }
			}
			return prefix + tr.firstElementChild.textContent.trim();
		}
		return el.getAttribute('name');
	}

	function cleanLabel(labelEl) {
		var clone = labelEl.cloneNode(true);
		var helps = clone.querySelectorAll('.ce-help');
		for (var i = 0; i < helps.length; i++) { helps[i].parentNode.removeChild(helps[i]); }
		return clone.textContent.trim();
	}

	function displayValueFor(el, value) {
		var fieldType = el.getAttribute('data-field-type');
		if (el.tagName === 'SELECT') {
			var opt = el.querySelector('option[value="' + cssEscapeValue(value) + '"]');
			return opt ? opt.textContent.trim() : value;
		}
		if (fieldType === 'BOOLEAN') { return value === 'true' ? 'Yes' : (value === 'false' ? 'No' : value); }
		if (fieldType === 'CODE_BUTTON_GROUP') {
			var group = el.closest('.code-items-group');
			var parts = String(value).split(SEP_MULTI);
			var labels = [];
			for (var i = 0; i < parts.length; i++) {
				var btn = group.querySelector('.code-item[value="' + cssEscapeValue(parts[i]) + '"]');
				labels.push(btn ? btn.textContent.trim() : parts[i]);
			}
			return labels.join(', ');
		}
		return value;
	}

	/* ------------------------------------------------------------------ *
	 * Panels
	 * ------------------------------------------------------------------ */
	function showPanel(which) {
		byId('ceLoadingPanel').style.display = which === 'loading' ? 'flex' : 'none';
		byId('ceMainPanel').style.display = which === 'form' ? 'block' : 'none';
		byId('ceFilledPanel').style.display = which === 'filled' ? 'block' : 'none';
	}

	function showInlineError(message) {
		var summary = byId('ceReviewSummary');
		if (!summary) { return; }
		showStep(stepEls.length - 1);
		var alert = summary.parentNode.querySelector('.ce-inline-error');
		if (!alert) {
			alert = document.createElement('div');
			alert.className = 'ce-inline-error alert alert-danger mt-3';
			summary.parentNode.insertBefore(alert, summary.nextSibling);
		}
		alert.textContent = message;
	}

	function parseIntOr(v, def) {
		if (v == null || v === '') { return def; }
		var n = parseInt(v, 10);
		return isNaN(n) ? def : n;
	}

	/* ------------------------------------------------------------------ *
	 * Bootstrapping
	 * ------------------------------------------------------------------ */
	function init() {
		form = byId('formAll');
		if (!form) { return; }

		populateStaticSelects();
		buildStepper();
		wireInputs();

		byId('ceSubmitBtn').addEventListener('click', function () { save(true); });
		byId('ceRetryBtn').addEventListener('click', function () { loadPlacemark(true); });
		byId('ceEditAnywayBtn').addEventListener('click', function () {
			showPanel('form');
			showStep(0);
		});
		form.addEventListener('submit', function (e) { e.preventDefault(); save(true); });

		loadPlacemark(false);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();

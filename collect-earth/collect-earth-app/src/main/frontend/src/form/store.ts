import { earthBase } from "../api";
import type { PanelKey } from "../shortcuts";
import type { MessageKey } from "../i18n";
import { ACTIVELY_SAVED, type Field, type FieldError, type FieldInfo, type FormModel, type LoadResult, answersToRemember, draftErrors,
  errorList, fieldsByName, isTabVisible, mergeInfos, saveBody, updateRequired } from "./model";

const REQUEST_TIMEOUT = 20000;
/** Typing is saved once the operator pauses; a click right away (the balloon uses the same delays). */
export const TYPING_DELAY = 1500;
export const CLICK_DELAY = 100;
/** The longest wait before a failed save is tried again: 1, 2, 4, 8, 16 s, then every 30 s */
export const MAX_RETRY_DELAY = 30000;
/** After this many failed saves in a row, nothing is tried again by itself: Retry is left to the operator */
export const MAX_AUTO_RETRIES = 10;

/** How long to wait before the retry that follows `failures` failed saves in a row (1 for the first) */
export function retryDelay(failures: number): number {
  return Math.min(MAX_RETRY_DELAY, 1000 * 2 ** Math.max(0, failures - 1));
}

export type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

export interface FormState {
  phase: "loading" | "ready" | "failed";
  /** why the form could not be shown (phase "failed") */
  failure: string | null;
  model: FormModel | null;
  placemarkId: string;
  /** server state of every field (value, relevance, errors, valid code items) */
  infos: Record<string, FieldInfo>;
  /** values typed or picked that the server has not confirmed yet */
  pending: Record<string, string>;
  tab: number;
  saveState: SaveState;
  /** the last request did not reach Collect Earth */
  serverDown: boolean;
  /** the last save reached Collect Earth, which could not save it: its reason ("" when it gave none) */
  saveError: string | null;
  /** a failed save is to be tried again by itself */
  retrying: boolean;
  /** the plot has been submitted (actively saved) and not edited since */
  submitted: boolean;
  /** opened on a plot that had already been submitted */
  alreadyFilled: boolean;
  /** submitted (when opened, or since), then changed: no longer submitted until it is submitted again */
  unsubmitted: boolean;
  /**
   * what the last Submit found unfinished, as it found it: the form lists what is still left of it until the next submit
   */
  submitErrors: FieldError[] | null;
  submitting: boolean;
  /** Submit was pressed on this plot: from then on, the questions not answered yet show as errors */
  attempted: boolean;
  /** entity being added or deleted */
  entityBusy: string | null;
  /** the last add or delete that failed, with the server's reason when it gave one */
  entityFailure: { entity: string; action: "add" | "delete"; message: string } | null;
  /**
   * opened on a plot submitted with questions left unanswered (before the server refused that): it lists them, and it
   * is not shown as submitted
   */
  incomplete: boolean;
  /**
   * The answers of the plot the collector submitted last in this session (another one), which "Same as previous plot"
   * copies: kept by the plots map, which tells the form of each plot it opens
   */
  previous: PreviousPlot | null;
  /** The number boxes holding what is no number (see numberProblem), by question: not sent, and Submit refused */
  drafts: Record<string, MessageKey>;
}

/** The answers of a plot submitted, by question (see answersToRemember) */
export interface PreviousPlot { plotId: string; answers: Record<string, string> }

/** The message by which the plots map tells the form the answers of the plot submitted before, in its survey */
export interface PreviousMessage { type: "ce:previous"; plotId: string; survey: string; answers: Record<string, string> }

/**
 * The answers of the plot submitted before, from a message of the plots map, or null for any other message, and for
 * those of this plot or of another survey
 */
export function previousOf(data: unknown, ownId: string, survey: string | null): PreviousPlot | null {
  const message = data as Partial<PreviousMessage> | null;
  if (!message || message.type !== "ce:previous" || typeof message.plotId !== "string" || message.plotId === ownId) return null;
  if (survey == null || message.survey !== survey) return null;
  const answers = message.answers;
  if (!answers || typeof answers !== "object") return null;
  const valid = Object.entries(answers).filter((e): e is [string, string] => typeof e[1] === "string");
  return valid.length ? { plotId: message.plotId, answers: Object.fromEntries(valid) } : null;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${url.replace(earthBase(), "")} HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** Collect Earth answered, with an error: not the same as a request that never reached it */
export class ServerError extends Error {}

async function postForm(path: string, body: URLSearchParams): Promise<LoadResult> {
  const r = await fetchWithTimeout(earthBase() + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
    body: body.toString(),
  });
  if (!r.ok) {
    // a failure answers 500 with { success: false, message } (PlacemarkDataController)
    let message = "";
    try {
      message = String(((await r.json()) as { message?: unknown }).message ?? "");
    } catch { /* not JSON */ }
    // no reason given: the form says it in its own words
    throw new ServerError(message);
  }
  return r.json() as Promise<LoadResult>;
}

/**
 * State and server traffic of the web form, as an external store (useSyncExternalStore).
 *
 * Saves are serialized, never aborted: every partial response carries the relevance and validation of
 * the fields it touched, so dropping one would leave fields shown or hidden wrongly.
 */
export class FormStore {
  private state: FormState;
  private listeners = new Set<() => void>();
  /** values from the plot file sent with every save (keys, CSV columns, location) */
  private plotValues: Record<string, string> = {};
  private dirty = new Set<string>();
  /** in the save in flight */
  private sending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  /** the retry of a failed save, waiting */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** saves failed in a row */
  private failures = 0;
  /** when a save was last tried again at once, on the window's "online" or "focus" (see retryOnEvent) */
  private lastEventRetry = -Infinity;
  private dirtyNotified = false;
  private fields: Record<string, Field> = {};
  /** the questions the server asked an answer for, answered since or not (see unansweredRequired) */
  private required = new Set<string>();
  /** the survey's name, for the answers of the plot before (see receive) */
  private survey: string | null = null;
  /** the save state with nothing waiting to be saved: what a change taken back returns to (see setDraftProblem) */
  private settled: SaveState = "idle";

  constructor(placemarkId: string) {
    this.state = {
      phase: "loading", failure: null, model: null, placemarkId, infos: {}, pending: {}, tab: 0, saveState: "idle",
      serverDown: false, saveError: null, retrying: false, submitted: false, alreadyFilled: false, unsubmitted: false, submitErrors: null, submitting: false, attempted: false,
      entityBusy: null, entityFailure: null, incomplete: false, previous: null, drafts: {},
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): FormState => this.state;

  /** fromServer: the patch carries the server's answer, which says which questions need an answer (see updateRequired) */
  private set(patch: Partial<FormState>, fromServer = false): void {
    this.state = { ...this.state, ...patch };
    if (patch.model || patch.infos) this.fields = this.state.model ? fieldsByName(this.state.model, this.state.infos) : {};
    // remembered once answered: its mark stays, as the server no longer says it is required
    if (fromServer) this.required = updateRequired(this.required, this.fields, this.state.infos, (n) => this.value(n));
    this.listeners.forEach((l) => l());
  }

  fieldsByName(): Record<string, Field> {
    return this.fields;
  }

  /** Whether the question needs an answer before the plot can be submitted, as far as the server said so */
  isRequired(name: string): boolean {
    return this.required.has(name);
  }

  // ---------- load ----------

  async load(): Promise<void> {
    const id = this.state.placemarkId;
    if (!id) {
      this.set({ phase: "failed", failure: "noPlot" });
      return;
    }
    let model: FormModel;
    try {
      const [m, plot] = await Promise.all([
        getJson<FormModel>(earthBase() + "surveyForm"),
        getJson<{ values: Record<string, string> }>(earthBase() + "surveyForm/plot?id=" + encodeURIComponent(id)),
      ]);
      model = m;
      this.plotValues = Object.fromEntries(Object.entries(plot.values ?? {}).filter(([, v]) => v != null)) as Record<string, string>;
      // the plots map answers with the answers of the plot submitted before in this survey (see receive)
      this.survey = model.survey;
      this.post("ce:ready", { survey: model.survey });
    } catch (e) {
      this.set({ phase: "failed", failure: (e as Error).message, serverDown: true });
      return;
    }
    try {
      const result = await getJson<LoadResult>(earthBase() + "placemark-info-expanded?id=" + encodeURIComponent(id));
      if (result.success) {
        const infos = mergeInfos({}, result, true);
        this.set({ model, infos }, true);
        const left = result.activelySaved ? errorList(model, infos) : [];
        const incomplete = left.length > 0;
        this.set({
          phase: "ready", alreadyFilled: !!result.activelySaved && !incomplete, submitted: !!result.activelySaved && !incomplete,
          tab: this.firstVisibleTab(0), saveState: result.activelySaved ? "saved" : "idle",
          incomplete, attempted: incomplete, submitErrors: incomplete ? left : null,
        });
      } else {
        // No record yet: the server builds one, as for the balloon, so its relevance and defaults come back. It stores
        // it only with the first answer, so there is nothing saved yet, and the plot is still not started
        this.set({ model, phase: "ready" });
        await this.save(false);
        this.set({ tab: this.firstVisibleTab(0), ...(this.state.saveState === "saved" ? { saveState: "idle" as const } : {}) });
      }
      if (!this.dirty.size) this.settled = this.state.saveState;
    } catch (e) {
      this.set({ phase: "failed", failure: (e as Error).message, serverDown: true });
    }
  }

  // ---------- editing ----------

  /** Value shown in a field: the operator's while it is being saved, else the server's. */
  value(name: string): string {
    return this.state.pending[name] ?? this.state.infos[name]?.value ?? "";
  }

  /** A value from the plot file (keys, CSV columns) */
  plotValue(name: string): string {
    return this.plotValues[name] ?? "";
  }

  setValue = (name: string, value: string, delay = CLICK_DELAY): void => {
    // The same answer again (a number key on the answer chosen): nothing changes, a submitted plot stays submitted; what
    // is typed and not saved yet is saved at the delay asked, as leaving a box asks for at once
    if (value === this.value(name)) {
      if (this.dirty.has(name)) this.schedule(delay);
      return;
    }
    this.dirty.add(name);
    const patch: Partial<FormState> = { pending: { ...this.state.pending, [name]: value }, saveState: "unsaved" };
    // clear the parent's dependants right away: their items no longer apply
    const dependants = Object.values(this.fields).filter((f) => f.code?.parent === name);
    if (dependants.length) {
      for (const d of dependants) {
        if (this.value(d.name)) {
          patch.pending![d.name] = "";
          this.dirty.add(d.name);
        }
      }
    }
    const wasSubmitted = this.state.submitted;
    if (wasSubmitted) Object.assign(patch, { submitted: false, unsubmitted: true });
    // the operator just answered: drop the field's error now, the server's answer brings it back if it stands
    const info = this.state.infos[name];
    if (info?.inError) patch.infos = { ...this.state.infos, [name]: { ...info, inError: false, errorMessage: null } };
    this.set(patch);
    if (!this.dirtyNotified || wasSubmitted) {
      this.dirtyNotified = true;
      this.post("ce:dirty", { unsubmitted: wasSubmitted });
    }
    this.schedule(delay);
  };

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.save(false); }, delay);
  }

  /** Saves what is pending now (waiting for the save in flight first). */
  flush = async (): Promise<void> => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inFlight) await this.inFlight;
    if (this.dirty.size) await this.save(false);
  };

  /**
   * The page is going away: the form closed, or another plot opened in its place. What is not saved yet, typed in the
   * pause before a save or in a save that the page takes with it, goes in a request that outlives the page.
   */
  saveOnLeave = (): void => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.cancelRetry();
    // a submit in flight is not sent again as a plain save, which would undo it
    const names = new Set([...this.dirty, ...(this.state.submitting ? [] : this.sending)]);
    if (!names.size) return;
    const values: Record<string, string> = { ...this.plotValues };
    for (const name of names) values[name] = this.state.pending[name] ?? this.state.infos[name]?.value ?? "";
    values[ACTIVELY_SAVED] = "false";
    if (navigator.sendBeacon(earthBase() + "save-data-expanded", saveBody(this.state.placemarkId, values, this.state.tab, true))) {
      this.dirty.clear();
    }
  };

  /** check: the whole form back, its validation included, even with nothing to save */
  private async save(activelySaved: boolean, check = false): Promise<LoadResult | null> {
    while (this.inFlight) await this.inFlight;
    // nothing left to save (a flush got there first); a new record, a check and a submit always go
    if (!activelySaved && !check && this.dirty.size === 0 && Object.keys(this.state.infos).length > 0) return null;
    const sending = [...this.dirty];
    this.dirty.clear();
    this.sending = new Set(sending);
    const values: Record<string, string> = { ...this.plotValues };
    for (const name of sending) values[name] = this.state.pending[name] ?? "";
    values[ACTIVELY_SAVED] = String(activelySaved);
    // A new record, and a submit, get the whole form back: errors of fields not touched by this save included
    const full = activelySaved || check || Object.keys(this.state.infos).length === 0;
    this.set({ saveState: "saving" });
    let result: LoadResult | null = null;
    const request = (async () => {
      try {
        result = await postForm("save-data-expanded", saveBody(this.state.placemarkId, values, this.state.tab, !full));
      } catch (e) {
        // Collect Earth answered with an error, or did not answer at all (null)
        result = e instanceof ServerError ? { success: false, message: e.message } as LoadResult : null;
      }
    })();
    this.inFlight = request;
    await request;
    this.inFlight = null;
    this.sending = new Set();
    const response = result as LoadResult | null;
    if (!response || !response.success) {
      sending.forEach((n) => this.dirty.add(n));
      this.failures++;
      this.settled = "error";
      this.set({ saveState: "error", serverDown: !response, saveError: response ? response.message ?? "" : null });
      this.scheduleRetry();
      return response;
    }
    this.failures = 0;
    this.settled = "saved";
    this.cancelRetry();
    const infos = mergeInfos(this.state.infos, response, full);
    const pending = { ...this.state.pending };
    for (const name of sending) {
      // keep what the operator typed while it is still in the queue, or when the server could not read it
      if (!this.dirty.has(name) && !infos[name]?.inError) delete pending[name];
    }
    this.dirtyNotified = this.dirty.size > 0;
    this.set({ infos, pending, serverDown: false, saveError: null, saveState: this.dirty.size ? "unsaved" : "saved" }, true);
    return response;
  }

  /** Whether a save failed and what it carried is still to be saved: the values, or the new record's first answer */
  private hasFailedSave(): boolean {
    return this.state.saveState === "error" && !!this.state.model
      && (this.dirty.size > 0 || Object.keys(this.state.infos).length === 0);
  }

  /**
   * The failed save is tried again by itself, later each time (see retryDelay); once at a time, and no more after
   * MAX_AUTO_RETRIES failures in a row
   */
  private scheduleRetry(): void {
    if (this.retryTimer || !this.hasFailedSave() || this.failures >= MAX_AUTO_RETRIES) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.retryNow();
    }, retryDelay(this.failures));
    this.set({ retrying: true });
  }

  private cancelRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.state.retrying) this.set({ retrying: false });
  }

  /**
   * Tries a failed save again now: when its time comes, the network is back (the window's "online"), the operator comes
   * back to the window ("focus"), or presses Retry. Nothing when no save failed. Never a second save while one is in
   * flight: saves wait for each other, and one that finds nothing left to save sends nothing.
   */
  /**
   * The window is back online, or has the focus again: a failed save is tried again at once, but once per wait between
   * retries at most (a window that gets the focus again and again would send one save after another), and not after
   * MAX_AUTO_RETRIES failures in a row.
   */
  retryOnEvent = async (): Promise<void> => {
    if (!this.hasFailedSave() || this.failures >= MAX_AUTO_RETRIES) return;
    const now = Date.now();
    if (now - this.lastEventRetry < retryDelay(this.failures)) return;
    this.lastEventRetry = now;
    await this.retryNow();
  };

  retryNow = async (): Promise<void> => {
    if (!this.hasFailedSave()) return;
    this.cancelRetry();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inFlight) await this.inFlight;
    if (this.hasFailedSave()) await this.save(false);
  };

  /**
   * Resolves once nothing typed or picked is waiting to be saved and the server's answer to it is in, with the questions
   * it showed or hid; or once the save failed.
   */
  whenSaved = (): Promise<void> => new Promise((resolve) => {
    const settled = () => this.state.saveState !== "unsaved" && this.state.saveState !== "saving";
    if (settled()) {
      resolve();
      return;
    }
    const stop = this.subscribe(() => {
      if (!settled()) return;
      stop();
      resolve();
    });
  });

  // ---------- submit ----------

  submit = async (): Promise<boolean> => {
    if (this.state.submitting || !this.state.model) return false;
    // A number box holding what is no number: not sent, so the plot would be submitted with the value saved before it
    const drafts = draftErrors(this.state.model, this.state.infos, this.state.drafts);
    if (drafts.length) {
      this.set({ submitErrors: drafts, attempted: true, tab: drafts[0].tab });
      return false;
    }
    // submitted on the map, if not complete; changed after it was submitted only when it was, complete
    const wasSubmitted = this.state.submitted || this.state.incomplete;
    const wasComplete = this.state.submitted;
    this.set({ submitting: true, submitErrors: null, attempted: true, incomplete: false });
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // The server submits a plot whose required questions are not answered (CollectRecord.getErrors leaves them out),
    // and the balloon refuses it (earth_web.js): the plot is checked first, on the server's state of the whole form,
    // and only submitted with nothing left in error
    const checked = await this.save(false, true);
    if (!checked || !checked.success) {
      this.set({ submitting: false });
      return false;
    }
    const left = errorList(this.state.model, this.state.infos);
    if (left.length) {
      // the check is a save that is not a submit: a plot submitted before is not anymore, on the map too
      if (wasSubmitted) this.post("ce:dirty", { unsubmitted: wasComplete });
      this.set({ submitting: false, submitted: false, submitErrors: left, tab: left[0].tab });
      return false;
    }
    const result = await this.save(true);
    this.set({ submitting: false });
    if (!result || !result.success) return false;
    // The server only keeps actively_saved when the whole record is valid (AbstractEarthSurveyService)
    if (result.activelySaved) {
      this.set({ submitted: true, unsubmitted: false, submitErrors: null });
      // the plots map keeps its answers for the next plot (see previous)
      this.post("ce:saved", { survey: this.state.model.survey,
        answers: answersToRemember(this.fields, this.state.model.keys, this.state.infos, (n) => this.value(n)) });
      return true;
    }
    const errors = errorList(this.state.model, this.state.infos);
    this.set({ submitErrors: errors, tab: errors.length ? errors[0].tab : this.state.tab });
    return false;
  };

  // ---------- multiple entities ----------

  addEntity = (entity: string): Promise<void> => this.entityRequest("create-entity", entity);

  deleteEntity = (entity: string): Promise<void> => this.entityRequest("delete-entity", entity);

  private async entityRequest(path: string, entity: string): Promise<void> {
    await this.flush();
    const action = path === "create-entity" ? "add" : "delete";
    this.set({ entityBusy: entity, entityFailure: null });
    const body = saveBody(this.state.placemarkId, { ...this.plotValues }, this.state.tab, true);
    body.append("entityName", entity);
    try {
      const result = await postForm(path, body);
      if (result.success) {
        const wasSubmitted = this.state.submitted;
        this.set({ infos: mergeInfos(this.state.infos, result, false), serverDown: false, submitted: false,
          unsubmitted: this.state.unsubmitted || wasSubmitted }, true);
        // the plots map shows it changed, and tells it when it is left so
        if (wasSubmitted) this.post("ce:dirty", { unsubmitted: true });
      } else {
        this.set({ saveState: "error", entityFailure: { entity, action, message: result.message ?? "" } });
      }
    } catch (e) {
      // an error of Collect Earth, with its reason when it gave one, is not Collect Earth not answering
      const server = e instanceof ServerError;
      this.set({ saveState: "error", serverDown: !server, entityFailure: { entity, action, message: server ? e.message : "" } });
    } finally {
      this.set({ entityBusy: null });
    }
  }

  // ---------- navigation ----------

  setTab = (tab: number): void => {
    this.set({ tab });
  };

  /** Next (or previous) tab with something to show, or -1. */
  neighbourTab(step: 1 | -1): number {
    const tabs = this.state.model?.tabs ?? [];
    for (let i = this.state.tab + step; i >= 0 && i < tabs.length; i += step) {
      if (isTabVisible(tabs[i], this.state.infos)) return i;
    }
    return -1;
  }

  private firstVisibleTab(from: number): number {
    const tabs = this.state.model?.tabs ?? [];
    for (let i = from; i < tabs.length; i++) if (isTabVisible(tabs[i], this.state.infos)) return i;
    return 0;
  }

  dismissAlreadyFilled = (): void => {
    this.set({ alreadyFilled: false });
  };

  retry = (): void => {
    if (this.state.phase === "failed") {
      this.set({ phase: "loading", failure: null });
      void this.load();
    } else if (this.hasFailedSave()) {
      void this.retryNow();
    } else {
      void this.flush();
    }
  };

  /** A message of the plots map (the parent page): the answers of the plot submitted before (see previous) */
  receive = (e: { origin: string; source: unknown; data: unknown }): void => {
    if (window.parent === window || e.source !== window.parent || e.origin !== window.location.origin) return;
    const previous = previousOf(e.data, this.state.placemarkId, this.survey);
    if (previous) this.set({ previous });
  };

  /**
   * A number box holds what is no number (`problem`), or no longer (null). What was typed in it before and is not sent
   * yet, the start of it that was a number ("1" of "1.5x"), is not sent: the server keeps what it has.
   */
  setDraftProblem = (name: string, problem: MessageKey | null): void => {
    if ((this.state.drafts[name] ?? null) === problem) return;
    const drafts = { ...this.state.drafts };
    if (problem) drafts[name] = problem;
    else delete drafts[name];
    const patch: Partial<FormState> = { drafts };
    if (problem && this.dirty.has(name)) {
      this.dirty.delete(name);
      const pending = { ...this.state.pending };
      delete pending[name];
      patch.pending = pending;
      if (!this.dirty.size) {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        patch.saveState = this.inFlight ? "saving" : this.settled;
      }
    }
    this.set(patch);
  };

  /** Passes a key of the plots map on to it ("/", "N", "Esc"): the form has the focus, so the plots map never sees them */
  passKey = (key: PanelKey): void => {
    this.post("ce:key", { key });
  };

  /**
   * Tells the plots map (the parent page) about the plot status, or a key pressed. A "ce:dirty" says `unsubmitted` when
   * the change took back a plot that was submitted, complete: the plots map says so if it is left that way.
   */
  private post(type: "ce:saved" | "ce:dirty" | "ce:key" | "ce:ready",
    extra?: { key: PanelKey } | { unsubmitted: boolean } | { survey: string; answers?: Record<string, string> }): void {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ type, plotId: this.state.placemarkId, ...extra }, window.location.origin);
    } catch { /* ignore */ }
  }
}

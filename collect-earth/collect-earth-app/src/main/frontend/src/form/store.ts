import { ACTIVELY_SAVED, type Field, type FieldInfo, type FormModel, type LoadResult, errorList, fieldsByName,
  isTabVisible, mergeInfos, saveBody } from "./model";

/** Base URL of the Collect Earth embedded server (the page is served from it). */
const HOST = window.location.origin + "/earth/";
const REQUEST_TIMEOUT = 20000;
/** Typing is saved once the operator pauses; a click right away (the balloon uses the same delays). */
export const TYPING_DELAY = 1500;
export const CLICK_DELAY = 100;

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
  /** the plot has been submitted (actively saved) and not edited since */
  submitted: boolean;
  /** opened on a plot that had already been submitted */
  alreadyFilled: boolean;
  /** the last Submit found errors: the list is shown until the next submit */
  submitErrors: { tab: number; field: Field; message: string }[] | null;
  submitting: boolean;
  /** entity being added or deleted */
  entityBusy: string | null;
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
  if (!r.ok) throw new Error(`${url.replace(HOST, "")} HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

async function postForm(path: string, body: URLSearchParams): Promise<LoadResult> {
  const r = await fetchWithTimeout(HOST + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
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
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private dirtyNotified = false;
  private fields: Record<string, Field> = {};

  constructor(placemarkId: string) {
    this.state = {
      phase: "loading", failure: null, model: null, placemarkId, infos: {}, pending: {}, tab: 0, saveState: "idle",
      serverDown: false, submitted: false, alreadyFilled: false, submitErrors: null, submitting: false, entityBusy: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): FormState => this.state;

  private set(patch: Partial<FormState>): void {
    this.state = { ...this.state, ...patch };
    if (patch.model || patch.infos) this.fields = this.state.model ? fieldsByName(this.state.model, this.state.infos) : {};
    this.listeners.forEach((l) => l());
  }

  fieldsByName(): Record<string, Field> {
    return this.fields;
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
        getJson<FormModel>(HOST + "surveyForm"),
        getJson<{ values: Record<string, string> }>(HOST + "surveyForm/plot?id=" + encodeURIComponent(id)),
      ]);
      model = m;
      this.plotValues = Object.fromEntries(Object.entries(plot.values ?? {}).filter(([, v]) => v != null)) as Record<string, string>;
    } catch (e) {
      this.set({ phase: "failed", failure: (e as Error).message, serverDown: true });
      return;
    }
    try {
      const result = await getJson<LoadResult>(HOST + "placemark-info-expanded?id=" + encodeURIComponent(id));
      if (result.success) {
        const infos = mergeInfos({}, result, true);
        this.set({ model, infos });
        this.set({
          phase: "ready", alreadyFilled: !!result.activelySaved, submitted: !!result.activelySaved,
          tab: this.firstVisibleTab(0), saveState: result.activelySaved ? "saved" : "idle",
        });
      } else {
        // No record yet: create it now, as the balloon does, so its relevance and defaults come back
        this.set({ model, phase: "ready" });
        await this.save(false);
        this.set({ tab: this.firstVisibleTab(0) });
      }
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
    this.dirty.add(name);
    const patch: Partial<FormState> = { pending: { ...this.state.pending, [name]: value }, saveState: "unsaved", submitErrors: null };
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
    if (this.state.submitted) patch.submitted = false;
    // the operator just answered: drop the field's error now, the server's answer brings it back if it stands
    const info = this.state.infos[name];
    if (info?.inError) patch.infos = { ...this.state.infos, [name]: { ...info, inError: false, errorMessage: null } };
    this.set(patch);
    if (!this.dirtyNotified) {
      this.dirtyNotified = true;
      this.post("ce:dirty");
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

  private async save(activelySaved: boolean): Promise<LoadResult | null> {
    while (this.inFlight) await this.inFlight;
    // nothing left to save (a flush got there first); a new record and a submit always go
    if (!activelySaved && this.dirty.size === 0 && Object.keys(this.state.infos).length > 0) return null;
    const sending = [...this.dirty];
    this.dirty.clear();
    const values: Record<string, string> = { ...this.plotValues };
    for (const name of sending) values[name] = this.state.pending[name] ?? "";
    values[ACTIVELY_SAVED] = String(activelySaved);
    // A new record, and a submit, get the whole form back: errors of fields not touched by this save included
    const full = activelySaved || Object.keys(this.state.infos).length === 0;
    this.set({ saveState: "saving" });
    let result: LoadResult | null = null;
    const request = (async () => {
      try {
        result = await postForm("save-data-expanded", saveBody(this.state.placemarkId, values, this.state.tab, !full));
      } catch {
        result = null;
      }
    })();
    this.inFlight = request;
    await request;
    this.inFlight = null;
    const response = result as LoadResult | null;
    if (!response || !response.success) {
      sending.forEach((n) => this.dirty.add(n));
      this.set({ saveState: "error", serverDown: !response });
      return response;
    }
    const infos = mergeInfos(this.state.infos, response, full);
    const pending = { ...this.state.pending };
    for (const name of sending) {
      // keep what the operator typed while it is still in the queue, or when the server could not read it
      if (!this.dirty.has(name) && !infos[name]?.inError) delete pending[name];
    }
    this.dirtyNotified = this.dirty.size > 0;
    this.set({ infos, pending, serverDown: false, saveState: this.dirty.size ? "unsaved" : "saved" });
    return response;
  }

  // ---------- submit ----------

  submit = async (): Promise<boolean> => {
    if (this.state.submitting || !this.state.model) return false;
    this.set({ submitting: true, submitErrors: null });
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const result = await this.save(true);
    this.set({ submitting: false });
    if (!result || !result.success) return false;
    // The server only keeps actively_saved when the whole record is valid (AbstractEarthSurveyService)
    if (result.activelySaved) {
      this.set({ submitted: true, submitErrors: null });
      this.post("ce:saved");
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
    this.set({ entityBusy: entity });
    const body = saveBody(this.state.placemarkId, { ...this.plotValues }, this.state.tab, true);
    body.append("entityName", entity);
    try {
      const result = await postForm(path, body);
      if (result.success) {
        this.set({ infos: mergeInfos(this.state.infos, result, false), serverDown: false, submitted: false });
      } else {
        this.set({ saveState: "error" });
      }
    } catch {
      this.set({ saveState: "error", serverDown: true });
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
    } else {
      void this.flush();
    }
  };

  /** Tells the plots map (the parent page) about the plot status */
  private post(type: "ce:saved" | "ce:dirty"): void {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ type, plotId: this.state.placemarkId }, window.location.origin);
    } catch { /* ignore */ }
  }
}

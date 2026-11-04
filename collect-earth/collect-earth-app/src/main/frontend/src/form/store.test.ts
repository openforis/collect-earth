import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldInfo, FormModel } from "./model";
import { CLICK_DELAY, FormStore, MAX_AUTO_RETRIES, MAX_RETRY_DELAY, previousOf, retryDelay } from "./store";

// The store in node: the form's page and Collect Earth's answers stood in for, the saves held (fake timers)

const model: FormModel = {
  survey: "s", language: "en", keys: [], csvFields: [], unsupported: [],
  tabs: [{ id: "a", label: "A", items: [
    { kind: "field", name: "collect_code_lu", type: "code", label: "Land use",
      code: { layout: "buttons", items: [{ id: 1, code: "F", label: "Forest" }, { id: 2, code: "C", label: "Cropland" }] } },
    { kind: "field", name: "collect_boolean_trees", type: "boolean", label: "Trees" },
  ] }],
};

/** What the plots map is told by the form */
let posted: Record<string, unknown>[];
/** Collect Earth's answer to a save (save-data-expanded), and to an entity added */
let saved: Record<string, FieldInfo>;
/** Whether Collect Earth takes a submit (the plot valid) */
let accepted: boolean;
/** Collect Earth's answer to the training feedback of a plot submitted, and the plots it was asked about */
let trainingAnswer: Record<string, unknown>;
let trainingAsked: string[];

/** opened: Collect Earth's answer to opening the plot, null when it has no record of it */
function serve(opened: { activelySaved: boolean; infos: Record<string, FieldInfo> } | null) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("http://localhost:8028/api/cloud/training-feedback")) {
      trainingAsked.push(new URL(url).searchParams.get("plot") ?? "");
      return { ok: true, json: async () => trainingAnswer };
    }
    const path = url.replace("http://localhost:8028/earth/", "");
    const json = path === "surveyForm" ? model
      : path.startsWith("surveyForm/plot") ? { values: {} }
        : path.startsWith("placemark-info-expanded")
          ? opened ? { success: true, activelySaved: opened.activelySaved, inputFieldInfoByParameterName: opened.infos } : { success: false }
          : { success: true, activelySaved: accepted, inputFieldInfoByParameterName: saved };
    return { ok: true, json: async () => json };
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  posted = [];
  saved = {};
  accepted = false;
  trainingAnswer = { status: "none" };
  trainingAsked = [];
  const page: Record<string, unknown> = { location: { origin: "http://localhost:8028" } };
  page.parent = { postMessage: (m: Record<string, unknown>) => posted.push(m) };
  vi.stubGlobal("window", page);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const answered = { collect_code_lu: { value: "F" }, collect_boolean_trees: { value: "true" } };

async function opened(activelySaved: boolean, infos: Record<string, FieldInfo>): Promise<FormStore> {
  serve({ activelySaved, infos });
  const store = new FormStore("p1");
  await store.load();
  return store;
}

const dirty = () => posted.filter((m) => m.type === "ce:dirty");

describe("a submitted plot", () => {
  it("stays submitted when an answer is given again as it was (a number key on the answer chosen)", async () => {
    const store = await opened(true, answered);
    expect(store.getState().submitted).toBe(true);
    store.setValue("collect_boolean_trees", "true");
    expect(store.getState().submitted).toBe(true);
    expect(store.getState().unsubmitted).toBe(false);
    expect(dirty()).toEqual([]);
  });
  it("is taken back by a change, and the plots map is told it was submitted", async () => {
    const store = await opened(true, answered);
    store.setValue("collect_boolean_trees", "false");
    expect(store.getState()).toMatchObject({ submitted: false, unsubmitted: true });
    expect(dirty()).toEqual([{ type: "ce:dirty", plotId: "p1", unsubmitted: true }]);
  });
  it("is taken back by an entity added, and the plots map is told so too", async () => {
    const store = await opened(true, answered);
    await store.addEntity("tree");
    expect(store.getState()).toMatchObject({ submitted: false, unsubmitted: true });
    expect(dirty()).toEqual([{ type: "ce:dirty", plotId: "p1", unsubmitted: true }]);
  });
});

describe("a plot not submitted", () => {
  it("tells the plots map of a change, never as one that took a submission back", async () => {
    const store = await opened(false, { collect_code_lu: {}, collect_boolean_trees: {} });
    store.setValue("collect_code_lu", "C");
    expect(store.getState().unsubmitted).toBe(false);
    expect(dirty()).toEqual([{ type: "ce:dirty", plotId: "p1", unsubmitted: false }]);
  });
  it("submitted with a question left unanswered: the check of a new Submit is no change after a submission", async () => {
    const left = { collect_code_lu: { value: "F" }, collect_boolean_trees: { inError: true } };
    const store = await opened(true, left);
    expect(store.getState().incomplete).toBe(true);
    saved = left;
    expect(await store.submit()).toBe(false);
    expect(store.getState().unsubmitted).toBe(false);
    expect(dirty()).toEqual([{ type: "ce:dirty", plotId: "p1", unsubmitted: false }]);
  });
});

describe("required questions", () => {
  it("are those the server reports in error while empty, still marked once answered", async () => {
    const store = await opened(false, { collect_code_lu: { inError: true }, collect_boolean_trees: {} });
    expect(store.isRequired("collect_code_lu")).toBe(true);
    expect(store.isRequired("collect_boolean_trees")).toBe(false);
    store.setValue("collect_code_lu", "F");
    expect(store.isRequired("collect_code_lu")).toBe(true);
  });
});

describe("a plot with no record", () => {
  it("opens with nothing saved and nothing changed: the plots map is not told it is started", async () => {
    serve(null);
    saved = { collect_code_lu: {}, collect_boolean_trees: {} };
    const store = new FormStore("p1");
    await store.load();
    expect(store.getState()).toMatchObject({ phase: "ready", saveState: "idle" });
    expect(store.getState().infos).toHaveProperty("collect_code_lu");
    expect(dirty()).toEqual([]);
  });
});

describe("a save that failed", () => {
  /** What Collect Earth does with each save, in turn: the last one again once they are used up */
  let saves: ("down" | "error" | "ok")[];
  let saveRequests: number;

  function serveSaves(...answers: ("down" | "error" | "ok")[]) {
    saves = answers;
    saveRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = url.replace("http://localhost:8028/earth/", "");
      if (path === "surveyForm") return { ok: true, json: async () => model };
      if (path.startsWith("surveyForm/plot")) return { ok: true, json: async () => ({ values: {} }) };
      if (path.startsWith("placemark-info-expanded")) {
        return { ok: true, json: async () => ({ success: true, activelySaved: false, inputFieldInfoByParameterName: { collect_code_lu: {}, collect_boolean_trees: {} } }) };
      }
      const answer = saves[Math.min(saveRequests++, saves.length - 1)];
      if (answer === "down") throw new TypeError("Failed to fetch");
      if (answer === "error") return { ok: false, status: 500, json: async () => ({ success: false, message: "The database is locked" }) };
      return { ok: true, json: async () => ({ success: true, activelySaved: false, inputFieldInfoByParameterName: { collect_code_lu: { value: "F" } } }) };
    }));
  }

  async function answered(): Promise<FormStore> {
    const store = new FormStore("p1");
    await store.load();
    store.setValue("collect_code_lu", "F");
    await vi.advanceTimersByTimeAsync(CLICK_DELAY);
    return store;
  }

  it("waits longer before each retry: 1, 2, 4, 8, 16 s, then 30 s at most", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it("is tried again by itself, later each time, until it is saved", async () => {
    serveSaves("down", "down", "down", "ok");
    const store = await answered();
    expect(saveRequests).toBe(1);
    expect(store.getState()).toMatchObject({ saveState: "error", serverDown: true, saveError: null, retrying: true });
    await vi.advanceTimersByTimeAsync(999);
    expect(saveRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(saveRequests).toBe(2);
    // then 2 s
    await vi.advanceTimersByTimeAsync(1999);
    expect(saveRequests).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(saveRequests).toBe(3);
    // then 4 s, and saved
    await vi.advanceTimersByTimeAsync(4000);
    expect(saveRequests).toBe(4);
    expect(store.getState()).toMatchObject({ saveState: "saved", serverDown: false, saveError: null, retrying: false });
    // nothing more is sent
    await vi.advanceTimersByTimeAsync(60000);
    expect(saveRequests).toBe(4);
  });

  it("an error of Collect Earth says its reason, and is tried again too", async () => {
    serveSaves("error", "ok");
    const store = await answered();
    expect(store.getState()).toMatchObject({ saveState: "error", serverDown: false, saveError: "The database is locked", retrying: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveRequests).toBe(2);
    expect(store.getState()).toMatchObject({ saveState: "saved", saveError: null });
  });

  it("is tried again at once when the network is back or the window has the focus, never twice at a time", async () => {
    serveSaves("down", "ok");
    const store = await answered();
    expect(saveRequests).toBe(1);
    // "online" and "focus" together: one save
    const online = store.retryOnEvent();
    const focus = store.retryOnEvent();
    await online;
    await focus;
    expect(saveRequests).toBe(2);
    expect(store.getState().saveState).toBe("saved");
    // the retry that was waiting is dropped
    await vi.advanceTimersByTimeAsync(30000);
    expect(saveRequests).toBe(2);
  });

  it("with nothing failed, the window's focus sends nothing", async () => {
    serveSaves("ok");
    const store = await answered();
    expect(saveRequests).toBe(1);
    await store.retryOnEvent();
    expect(saveRequests).toBe(1);
  });

  it("is tried again on the focus once per wait between retries at most", async () => {
    serveSaves("down");
    const store = await answered();
    expect(saveRequests).toBe(1);
    await store.retryOnEvent();
    expect(saveRequests).toBe(2);
    // focus again and again: nothing more until the wait after 2 failures (2 s) has passed
    await vi.advanceTimersByTimeAsync(500);
    await store.retryOnEvent();
    await store.retryOnEvent();
    expect(saveRequests).toBe(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(saveRequests).toBe(3); // the retry that was waiting
    await store.retryOnEvent();
    expect(saveRequests).toBe(3);
    await vi.advanceTimersByTimeAsync(4000);
    expect(saveRequests).toBe(4); // the retry at 4 s
    // 8 s, the wait after 4 failures, since the focus that sent one: it sends one again
    await vi.advanceTimersByTimeAsync(2000);
    await store.retryOnEvent();
    expect(saveRequests).toBe(5);
  });

  it("stops trying by itself after 10 failures in a row, and Retry still tries", async () => {
    serveSaves("down");
    const store = await answered();
    await vi.advanceTimersByTimeAsync(10 * MAX_RETRY_DELAY);
    expect(saveRequests).toBe(MAX_AUTO_RETRIES);
    expect(store.getState()).toMatchObject({ saveState: "error", retrying: false });
    await vi.advanceTimersByTimeAsync(10 * MAX_RETRY_DELAY);
    await store.retryOnEvent();
    expect(saveRequests).toBe(MAX_AUTO_RETRIES);
    serveSaves("ok");
    store.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveRequests).toBe(1);
    expect(store.getState().saveState).toBe("saved");
  });

  it("an error of Collect Earth with no reason is shown in the form's own words", async () => {
    serveSaves("error");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = url.replace("http://localhost:8028/earth/", "");
      if (path === "surveyForm") return { ok: true, json: async () => model };
      if (path.startsWith("surveyForm/plot")) return { ok: true, json: async () => ({ values: {} }) };
      if (path.startsWith("placemark-info-expanded")) {
        return { ok: true, json: async () => ({ success: true, activelySaved: false, inputFieldInfoByParameterName: {} }) };
      }
      return { ok: false, status: 500, json: async () => ({ success: false, message: "" }) };
    }));
    const store = await answered();
    expect(store.getState()).toMatchObject({ saveState: "error", serverDown: false, saveError: "" });
  });

  it("a row that could not be added says why, as an error of Collect Earth, not as Collect Earth not answering", async () => {
    serveSaves("error");
    const store = new FormStore("p1");
    await store.load();
    await store.addEntity("tree");
    expect(store.getState()).toMatchObject({ serverDown: false,
      entityFailure: { entity: "tree", action: "add", message: "The database is locked" } });
  });

  it("Retry tries it again at once, and the backoff starts over once saved", async () => {
    serveSaves("down", "down", "ok", "down");
    const store = await answered();
    store.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveRequests).toBe(2);
    // the second failure waits 2 s
    await vi.advanceTimersByTimeAsync(1999);
    expect(saveRequests).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(saveRequests).toBe(3);
    expect(store.getState().saveState).toBe("saved");
    // a new failure after a save waits 1 s again
    store.setValue("collect_code_lu", "C");
    await vi.advanceTimersByTimeAsync(CLICK_DELAY);
    expect(saveRequests).toBe(4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveRequests).toBe(5);
  });
});

describe("same as previous plot", () => {
  it("asks the plots map for the answers of the plot submitted before in its survey, as the plot opens", async () => {
    await opened(false, { collect_code_lu: {}, collect_boolean_trees: {} });
    expect(posted.filter((m) => m.type === "ce:ready")).toEqual([{ type: "ce:ready", plotId: "p1", survey: "s" }]);
  });
  it("tells the plots map the answers of a plot submitted, for the next one", async () => {
    const store = await opened(false, { collect_code_lu: { value: "F" }, collect_boolean_trees: {} });
    saved = { collect_code_lu: { value: "F" }, collect_boolean_trees: {} };
    accepted = true;
    expect(await store.submit()).toBe(true);
    expect(posted.filter((m) => m.type === "ce:saved"))
      .toEqual([{ type: "ce:saved", plotId: "p1", survey: "s", answers: { collect_code_lu: "F" } }]);
  });
  it("takes the answers the plots map sends back, from the plots map only, and never those of its own plot", async () => {
    const store = await opened(false, { collect_code_lu: {}, collect_boolean_trees: {} });
    const parent = (window as unknown as { parent: unknown }).parent;
    const origin = "http://localhost:8028";
    const data = { type: "ce:previous", plotId: "p0", survey: "s", answers: { collect_code_lu: "C" } };
    store.receive({ origin, source: {}, data });
    store.receive({ origin: "https://evil.example", source: parent, data });
    store.receive({ origin, source: parent, data: { ...data, survey: "other" } });
    expect(store.getState().previous).toBeNull();
    store.receive({ origin, source: parent, data });
    expect(store.getState().previous).toEqual({ plotId: "p0", answers: { collect_code_lu: "C" } });
  });
  it("reads the message of the plots map, nothing else", () => {
    const of = (data: unknown) => previousOf(data, "p1", "s");
    expect(of({ type: "ce:previous", plotId: "p1", survey: "s", answers: { a: "1" } })).toBeNull();
    expect(of({ type: "ce:previous", plotId: "p0", survey: "s", answers: {} })).toBeNull();
    expect(of({ type: "ce:previous", plotId: "p0", survey: "s", answers: { a: 1, b: "2" } })).toEqual({ plotId: "p0", answers: { b: "2" } });
    expect(of({ type: "ce:previous", plotId: "p0", survey: "t", answers: { a: "1" } })).toBeNull();
    expect(previousOf({ type: "ce:previous", plotId: "p0", survey: "s", answers: { a: "1" } }, "p1", null)).toBeNull();
    expect(of({ type: "ce:key", plotId: "p0" })).toBeNull();
    expect(of(null)).toBeNull();
  });
});

describe("a number box holding no number", () => {
  it("refuses Submit, listing it, without a request", async () => {
    const store = await opened(false, { collect_code_lu: { value: "F" }, collect_boolean_trees: { value: "true" } });
    const requests = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    store.setDraftProblem("collect_boolean_trees", "entry.invalidInteger");
    expect(await store.submit()).toBe(false);
    expect(store.getState().submitErrors?.map((e) => [e.field.name, e.problem])).toEqual([["collect_boolean_trees", "entry.invalidInteger"]]);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(requests);
    store.setDraftProblem("collect_boolean_trees", null);
    expect(store.getState().drafts).toEqual({});
  });
  it("does not send the start of it typed before, which was a number", async () => {
    const store = await opened(false, { collect_code_lu: { value: "F" }, collect_boolean_trees: { value: "" } });
    store.setValue("collect_boolean_trees", "1", 1500);
    expect(store.getState().saveState).toBe("unsaved");
    store.setDraftProblem("collect_boolean_trees", "entry.invalidInteger");
    expect(store.value("collect_boolean_trees")).toBe("");
    expect(store.getState().saveState).toBe("idle");
    const requests = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(requests);
  });
});

describe("the training feedback of a plot submitted", () => {
  it("reads the server's answer, nothing for none or an odd one", async () => {
    const { toTrainingFeedback } = await import("./store");
    expect(toTrainingFeedback({ status: "none" })).toBeNull();
    expect(toTrainingFeedback(null)).toBeNull();
    expect(toTrainingFeedback({ status: "pending", set: "Week 1", attempt: 2 })).toEqual({ status: "pending", set: "Week 1", attempt: 2, plot: undefined });
    const scored = toTrainingFeedback({
      status: "scored",
      set: "Week 1",
      plot: { plot: "9001", right: false, answers: { compared: 2, agreeing: 1 }, note: "  ", questions: [{ key: "lu", label: "Land use", golden: "Forest (F)", given: "Grassland (G)", right: false }] },
    });
    expect(scored?.plot?.questions[0]).toEqual({ key: "lu", label: "Land use", golden: "Forest (F)", given: "Grassland (G)", right: false });
    expect(scored?.plot?.note).toBeNull();
  });
});

describe("a learning plot submitted", () => {
  it("asks Collect Earth how the answers compare with the golden ones, and forgets it once the plot changes", async () => {
    const store = await opened(false, { collect_code_lu: { value: "F" }, collect_boolean_trees: {} });
    saved = { collect_code_lu: { value: "F" }, collect_boolean_trees: {} };
    accepted = true;
    trainingAnswer = { status: "scored", set: "Week 1", attempt: 1, plot: { plot: "p1", right: true, answers: { compared: 1, agreeing: 1 }, note: null, questions: [{ key: "collect_code_lu", label: "Land use", golden: "F", given: "F", right: true }] } };
    expect(await store.submit()).toBe(true);
    await vi.waitFor(() => expect(store.getState().training?.status).toBe("scored"));
    expect(trainingAsked).toEqual(["p1"]);
    expect(store.getState().training?.plot?.questions[0].right).toBe(true);
    store.setValue("collect_code_lu", "C");
    expect(store.getState().training).toBeNull();
  });
  it("shows nothing for a plot that is no training plot", async () => {
    const store = await opened(false, { collect_code_lu: { value: "F" }, collect_boolean_trees: {} });
    saved = { collect_code_lu: { value: "F" }, collect_boolean_trees: {} };
    accepted = true;
    expect(await store.submit()).toBe(true);
    await vi.waitFor(() => expect(store.getState().trainingLoading).toBe(false));
    expect(store.getState().training).toBeNull();
  });
});

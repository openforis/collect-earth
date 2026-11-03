import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldInfo, FormModel } from "./model";
import { FormStore } from "./store";

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

/** opened: Collect Earth's answer to opening the plot, null when it has no record of it */
function serve(opened: { activelySaved: boolean; infos: Record<string, FieldInfo> } | null) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = url.replace("http://localhost:8028/earth/", "");
    const json = path === "surveyForm" ? model
      : path.startsWith("surveyForm/plot") ? { values: {} }
        : path.startsWith("placemark-info-expanded")
          ? opened ? { success: true, activelySaved: opened.activelySaved, inputFieldInfoByParameterName: opened.infos } : { success: false }
          : { success: true, activelySaved: false, inputFieldInfoByParameterName: saved };
    return { ok: true, json: async () => json };
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  posted = [];
  saved = {};
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

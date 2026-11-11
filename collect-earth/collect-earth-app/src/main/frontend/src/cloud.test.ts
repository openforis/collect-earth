import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CloudState, type CloudSync, fallbackState, projectChip, projectMark, saveView } from "./cloud";
import { translator } from "./i18n";
import { cloudSignOut, cloudState, recordSync } from "./projectApi";

const t = translator("en");
const when = (iso: string) => "at " + iso;

const local = (accounts: CloudState["accounts"] = []): CloudState => ({ ...fallbackState("Forest", false), accounts });
const cloud = (sync: Partial<CloudSync> | null, project: Partial<CloudState["project"]> = {}): CloudState => ({
  project: { mode: "cloud", name: "Forest", server: "https://cloud.example.org", serverName: "Example Cloud", cloudProjectId: "p-1",
    cloudProjectName: "Forest 2026", account: "ana", signedIn: true, ...project },
  sync: sync && { pending: 0, failed: 0, lastSyncedOn: null, lastError: null, online: true, needsSignIn: false, ...sync },
  accounts: [{ server: "https://cloud.example.org", serverName: "Example Cloud", username: "ana" }],
});

describe("the project chip", () => {
  it("says a local project keeps its data on this computer, and does nothing on a click", () => {
    expect(projectChip(local(), t, when)).toEqual({
      icon: "computer", label: "On this computer", status: null, name: "On this computer",
      tip: "This project keeps its data on this computer.", color: "default", action: null,
    });
  });

  it("says that the accounts signed in get nothing of a local project", () => {
    const chip = projectChip(local([
      { server: "https://a.org", serverName: "A", username: "ana" }, { server: "https://b.org", serverName: "", username: "bo" },
    ]), t, when);
    expect(chip.tip).toBe("This project keeps its data on this computer. You are signed in to A as ana, https://b.org as bo, "
      + "but nothing of this project is sent there.");
  });

  it("names the cloud project, its server and the account, with a tick when all is sent", () => {
    const chip = projectChip(cloud({ lastSyncedOn: "2026-11-11T10:00:00Z" }), t, when);
    expect(chip).toMatchObject({ icon: "sent", label: "Cloud · Example Cloud", status: null, name: "Cloud · Example Cloud · All sent",
      color: "success", action: "status" });
    expect(chip.tip).toBe("Cloud project “Forest 2026” on Example Cloud, as ana. Plots are saved on this computer first, then sent. "
      + "Last sync: at 2026-11-11T10:00:00Z.");
  });

  it("counts the plots waiting, offline or not", () => {
    expect(projectChip(cloud({ pending: 3 }), t, when)).toMatchObject({ icon: "waiting", status: "3 waiting to send", color: "warning" });
    expect(projectChip(cloud({ pending: 3, online: false }), t, when)).toMatchObject({ icon: "offline", status: "Offline · 3 waiting", color: "warning" });
    expect(projectChip(cloud({ online: false }), t, when)).toMatchObject({ icon: "offline", status: "Offline" });
    // Not known to be offline: only what waits
    expect(projectChip(cloud({ pending: 1, online: null }), t, when).status).toBe("1 waiting to send");
  });

  it("says the plots that failed before those waiting", () => {
    expect(projectChip(cloud({ pending: 4, failed: 2 }), t, when)).toMatchObject({ icon: "failed", status: "2 failed", color: "warning",
      name: "Cloud · Example Cloud · 2 failed" });
  });

  it("asks for the sign-in, in red, when the server no longer takes it or nobody signed in", () => {
    expect(projectChip(cloud({ pending: 5, needsSignIn: true }), t, when)).toMatchObject({ icon: "signIn", status: "Sign in again", color: "error", action: "signIn" });
    expect(projectChip(cloud({}, { signedIn: false, account: null }), t, when)).toMatchObject({ status: "Not signed in", action: "signIn" });
  });

  it("claims nothing of the sending when there is no sync, and does without what it does not know", () => {
    const chip = projectChip(cloud(null, { account: null, cloudProjectName: null }), t, when);
    expect(chip).toMatchObject({ icon: "cloud", status: null, name: "Cloud · Example Cloud", color: "default" });
    expect(chip.tip).toBe("Cloud project “p-1” on Example Cloud. Plots are saved on this computer first, then sent.");
    // Before /api/cloud/state answers: what /api/app knows
    expect(projectChip(fallbackState("Forest", true), t, when)).toMatchObject({ icon: "cloud", label: "Cloud project",
      tip: "Cloud project “Forest”. Plots are saved on this computer first, then sent." });
  });
});

describe("the mark of a project in the list", () => {
  it("is this computer for a local project, the cloud's server for a cloud one", () => {
    expect(projectMark({ name: "A", folder: "a", active: true }, t)).toEqual({ icon: "computer", label: "On this computer", detail: null });
    expect(projectMark({ name: "A", folder: "a", active: false, cloud: null }, t).icon).toBe("computer");
    const c = { server: "https://cloud.example.org", serverName: "Example Cloud", projectName: "Forest 2026" };
    expect(projectMark({ name: "A", folder: "a", active: false, cloud: c }, t))
      .toEqual({ icon: "cloud", label: "Cloud · Example Cloud", detail: "Cloud project “Forest 2026”" });
    // The cloud project's name only when it is not the project's own; the address when the server has no name
    expect(projectMark({ name: "Forest 2026", folder: "a", active: false, cloud: { ...c, serverName: "" } }, t))
      .toEqual({ icon: "cloud", label: "Cloud · https://cloud.example.org", detail: null });
  });
});

describe("the save message of the form", () => {
  const key = (...args: Parameters<typeof saveView>) => saveView(...args).key;

  it("says saved on this computer in a local project, or one not known", () => {
    expect(saveView("saved", false, false, null)).toEqual({ key: "entry.save.saved", icon: "saved", color: "success" });
    expect(key("saved", false, null, null)).toBe("entry.save.saved");
    // A local project's record is never said to be sent
    expect(key("saved", false, false, "sent")).toBe("entry.save.saved");
    expect(t("entry.save.saved")).toBe("Saved on this computer");
  });

  it("says sent in a cloud project only once the record is", () => {
    expect(key("saved", false, true, null)).toBe("entry.save.saved");
    expect(saveView("saved", false, true, "pending")).toEqual({ key: "entry.save.waiting", icon: "waiting", color: "default" });
    expect(key("saved", false, true, "local")).toBe("entry.save.waiting");
    expect(saveView("saved", false, true, "sent")).toEqual({ key: "entry.save.sent", icon: "sent", color: "success" });
    expect(saveView("saved", false, true, "failed")).toEqual({ key: "entry.save.notSent", icon: "notSent", color: "warning" });
    expect([t("entry.save.waiting"), t("entry.save.sent"), t("entry.save.notSent")])
      .toEqual(["Saved on this computer · waiting to send", "Saved and sent to the cloud", "Saved on this computer · not sent yet"]);
  });

  it("keeps the states before the save, whatever the sending", () => {
    expect(key("unsaved", false, true, "sent")).toBe("entry.save.unsaved");
    expect(key("saving", false, true, "sent")).toBe("entry.save.saving");
    expect(key("idle", false, true, "sent")).toBe("entry.save.idle");
    expect(saveView("error", false, true, "sent")).toEqual({ key: "entry.save.error", icon: "error", color: "error" });
    expect(key("error", true, false, null)).toBe("entry.save.retrying");
  });
});

describe("the calls", () => {
  beforeEach(() => vi.stubGlobal("window", { location: { origin: "http://localhost:8028" } }));
  afterEach(() => vi.unstubAllGlobals());
  const answering = (body: unknown) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("read the state, sign out of a server and ask where a record is", async () => {
    const state = cloud({ pending: 1 });
    let fetchMock = answering(state);
    expect(await cloudState()).toEqual(state);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8028/earth/api/cloud/state");

    fetchMock = answering(local());
    expect(await cloudSignOut("https://cloud.example.org")).toEqual(local());
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8028/earth/api/cloud/signOut");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ server: "https://cloud.example.org" }) });

    fetchMock = answering({ state: "sent" });
    expect(await recordSync("A 1,B&2")).toBe("sent");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8028/earth/api/cloud/recordSync?key=A%201%2CB%262");
  });
});

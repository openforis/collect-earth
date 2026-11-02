import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActivity,
  getAttention,
  getExport,
  getWeekly,
  markAttentionRead,
  addMapPage,
  getMapPlots,
  OSM_TILES,
  toMapTiles,
  bulkDecisions,
  getFlags,
  getReviewQueue,
  getPlotPage,
  searchPlots,
  saveFastSeconds,
  absoluteUrl,
  ApiError,
  apiErrorFrom,
  changePassword,
  createInvite,
  deleteAccount,
  deleteProject,
  errorMessageKey,
  getAccountDeletion,
  getCsvColumns,
  getDistribution,
  getQuality,
  toQualityData,
  saveQualityMargins,
  setQualityDecision,
  deleteQualityDecision,
  createGuidanceNote,
  updateGuidanceNote,
  deleteGuidanceNote,
  getPlotPlaces,
  moveUnfinished,
  saveDistribution,
  getOverview,
  getServerInfo,
  listProjects,
  login,
  safeUrl,
  saveServerSettings,
  setUnauthorizedHandler,
  signup,
  toCount,
  toMillis,
  toServerSettings,
  DEFAULT_SERVER_SETTINGS,
  downloadOriginalCep,
  downloadCollectBackup,
  getBackupSummary,
  getRoundInfo,
  setReassessmentCode,
  toRoundInfo,
  uploadCep,
  getProjectAi,
  setProjectAi,
  startAiRun,
  listAiRuns,
  getAiRun,
  getAiUsage,
  getServerOverview,
  setUserDisabled,
  listMembers,
  toPersonRow,
  getMyQuality,
  getTeamReport,
} from "./api";
import { CATALOGUES } from "./i18n";
import { setToken } from "./storage";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { origin: "https://ce.example.org" } });
  setToken(null);
});

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe("error messages", () => {
  const cases: [string, number, string][] = [
    ["invalid_credentials", 401, "error.invalidCredentials"],
    ["username_taken", 409, "error.usernameTaken"],
    ["signup_closed", 403, "error.signupClosed"],
    ["weak_password", 400, "error.weakPassword"],
    ["bad_username", 400, "error.badUsername"],
    ["bad_setup_code", 403, "error.badSetupCode"],
    ["already_set_up", 409, "error.alreadySetUp"],
    ["project_creation_restricted", 403, "error.projectCreationRestricted"],
    ["last_admin", 409, "error.lastAdmin"],
    ["invite_exhausted", 410, "error.inviteExhausted"],
    ["invalid_invite", 400, "error.inviteInvalid"],
    ["invalid_reset_token", 410, "error.linkUsedOrExpired"],
    ["rate_limited", 429, "error.rateLimited"],
    ["unauthorized", 401, "error.sessionEnded"],
    ["project_limit_reached", 403, "error.projectLimitReached"],
    ["storage_limit_reached", 413, "error.storageLimitReached"],
    ["confirm_mismatch", 400, "error.confirmMismatch"],
    ["sole_coordinator", 409, "error.soleCoordinator"],
    ["last_platform_admin", 409, "error.lastPlatformAdmin"],
    ["terms_not_accepted", 400, "error.termsNotAccepted"],
  ];
  it.each(cases)("%s becomes a sentence", (code, status, key) => {
    expect(errorMessageKey(apiErrorFrom(status, { error: code }))).toBe(key);
  });

  it("falls back on the HTTP status for unknown codes", () => {
    expect(errorMessageKey(apiErrorFrom(429, null))).toBe("error.rateLimited");
    expect(errorMessageKey(apiErrorFrom(410, { error: "gone" }))).toBe("error.linkUsedOrExpired");
    expect(errorMessageKey(apiErrorFrom(413, "Payload Too Large"))).toBe("error.tooLarge");
    expect(errorMessageKey(apiErrorFrom(502, null))).toBe("error.server");
    expect(errorMessageKey(apiErrorFrom(404, { error: "not_found" }))).toBe("error.notFound");
    expect(errorMessageKey(apiErrorFrom(418, null))).toBe("error.unknown");
    expect(errorMessageKey(new Error("boom"))).toBe("error.unknown");
  });

  it("every message key exists in the catalogue", () => {
    const codes = ["network", ...cases.map((c) => c[0]), "wrong_password", "forbidden", "not_found", "payload_too_large", "x"];
    for (const code of codes) {
      for (const status of [0, 400, 401, 403, 404, 410, 413, 429, 500, 418]) {
        expect(CATALOGUES.en[errorMessageKey(new ApiError(status, code))]).toBeTruthy();
      }
    }
  });

  it("keeps the server's reason", () => {
    const error = apiErrorFrom(400, { error: "bad_request", reason: "invalid filename" });
    expect(error.code).toBe("bad_request");
    expect(error.reason).toBe("invalid filename");
    expect(errorMessageKey(error)).toBe("error.badRequest");
  });
});

describe("transport", () => {
  it("a network failure is an ApiError with status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await listProjects().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect(errorMessageKey(error)).toBe("error.network");
  });

  it("sends the session as a bearer token", async () => {
    setToken("tok-1");
    fetchMock.mockResolvedValue(jsonResponse(200, { projects: [{ projectId: "p", projectName: "P", role: "admin" }] }));
    expect(await listProjects()).toEqual([{ projectId: "p", projectName: "P", role: "admin" }]);
    const init = fetchMock.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });

  it("a 401 on a logged-in call ends the session", async () => {
    setToken("expired");
    const ended = vi.fn();
    setUnauthorizedHandler(ended);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));
    await expect(listProjects()).rejects.toBeInstanceOf(ApiError);
    expect(ended).toHaveBeenCalledOnce();
  });

  it("a wrong password at log in does not count as a session ending", async () => {
    setToken("still-valid");
    const ended = vi.fn();
    setUnauthorizedHandler(ended);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "invalid_credentials" }));
    const error = await login("maria", "nope").catch((e: unknown) => e);
    expect(errorMessageKey(error)).toBe("error.invalidCredentials");
    expect(ended).not.toHaveBeenCalled();
  });

  it("a 401 when changing the password means the current one is wrong", async () => {
    setToken("valid");
    const ended = vi.fn();
    setUnauthorizedHandler(ended);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "invalid_credentials" }));
    const error = await changePassword("bad", "newpassword").catch((e: unknown) => e);
    expect(errorMessageKey(error)).toBe("error.wrongPassword");
    expect(ended).not.toHaveBeenCalled();
  });
});

describe("normalising responses", () => {
  it("server info from a server without the dashboard endpoints", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    expect(await getServerInfo()).toEqual({
      needsSetup: false,
      signupOpen: false,
      projectCreation: "platform-admins",
      version: null,
      termsUrl: null,
      contactEmail: null,
      serverName: null,
      aiAvailable: false,
      mapTiles: OSM_TILES,
    });
  });

  it("server info", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { needsSetup: true, signupOpen: true, projectCreation: "anyone", version: "0.2.0" }));
    expect(await getServerInfo()).toEqual({
      needsSetup: true,
      signupOpen: true,
      projectCreation: "anyone",
      version: "0.2.0",
      termsUrl: null,
      contactEmail: null,
      serverName: null,
      aiAvailable: false,
      mapTiles: OSM_TILES,
    });
  });

  it("server info with terms, contact and name; only http(s) terms links get through", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { needsSetup: false, termsUrl: "https://e.org/terms", contactEmail: " help@e.org ", serverName: "FAO Cloud" }),
    );
    expect(await getServerInfo()).toMatchObject({ termsUrl: "https://e.org/terms", contactEmail: "help@e.org", serverName: "FAO Cloud" });
    fetchMock.mockResolvedValue(jsonResponse(200, { termsUrl: "javascript:alert(1)", serverName: "" }));
    expect(await getServerInfo()).toMatchObject({ termsUrl: null, serverName: null });
    expect(safeUrl("http://a.org")).toBe("http://a.org");
    expect(safeUrl(42)).toBeNull();
  });

  it("overview storage, and none from older servers", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { name: "P", records: {}, storage: { usedBytes: 1200, limitBytes: null } }));
    expect((await getOverview("p1")).storage).toEqual({ usedBytes: 1200, limitBytes: null });
    fetchMock.mockResolvedValue(jsonResponse(200, { name: "P", records: {}, storage: { usedBytes: 5, limitBytes: 1048576 } }));
    expect((await getOverview("p1")).storage).toEqual({ usedBytes: 5, limitBytes: 1048576 });
    fetchMock.mockResolvedValue(jsonResponse(200, { name: "P", records: {} }));
    expect((await getOverview("p1")).storage).toBeNull();
  });

  it("server settings keep what an older server does not send", () => {
    expect(toServerSettings({ signupOpen: true, projectCreation: "anyone" })).toEqual({ ...DEFAULT_SERVER_SETTINGS, signupOpen: true, projectCreation: "anyone" });
    const current = { ...DEFAULT_SERVER_SETTINGS, maxProjectsPerUser: 3, termsUrl: "https://e.org/t" };
    expect(toServerSettings({ termsUrl: null, maxProjectsPerUser: -1 }, current)).toEqual({ ...current, termsUrl: null });
  });

  it("saving settings sends only the changes", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...DEFAULT_SERVER_SETTINGS, maxProjectStorageMb: 200 }));
    const saved = await saveServerSettings(DEFAULT_SERVER_SETTINGS, { maxProjectStorageMb: 200 });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ maxProjectStorageMb: 200 });
    expect(saved.maxProjectStorageMb).toBe(200);
  });

  it("sign-up sends acceptTerms only when accepted", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(201, { token: "t", userId: "u", username: "maria" }));
    await signup("maria", "password1", undefined, true);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ username: "maria", password: "password1", acceptTerms: true });
    await signup("juan", "password1");
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ username: "juan", password: "password1" });
  });

  it("deletes a project with its name", async () => {
    setToken("tok");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteProject("p 1", "Bolivia NFI");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/v1/projects/p%201");
    expect(init!.method).toBe("DELETE");
    expect(JSON.parse(init!.body as string)).toEqual({ confirmName: "Bolivia NFI" });
  });

  it("a wrong password when deleting the account does not end the session", async () => {
    setToken("valid");
    const ended = vi.fn();
    setUnauthorizedHandler(ended);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "invalid_credentials" }));
    const error = await deleteAccount("bad").catch((e: unknown) => e);
    expect(errorMessageKey(error)).toBe("error.wrongPassword");
    expect(ended).not.toHaveBeenCalled();
  });

  it("a refused account deletion keeps the projects it names", async () => {
    setToken("valid");
    fetchMock.mockResolvedValue(jsonResponse(409, { error: "sole_coordinator", projects: [{ projectId: "p", name: "P" }] }));
    const error = (await deleteAccount("good-password").catch((e: unknown) => e)) as ApiError;
    expect(errorMessageKey(error)).toBe("error.soleCoordinator");
    expect(error.details.projects).toEqual([{ projectId: "p", name: "P" }]);
  });

  it("reads what deleting the account would do", async () => {
    setToken("valid");
    fetchMock.mockResolvedValue(jsonResponse(200, { soleCoordinator: [], deletedWithAccount: [{ projectId: "p", name: "Mine" }], lastPlatformAdmin: false }));
    expect(await getAccountDeletion()).toEqual({ soleCoordinator: [], deletedWithAccount: [{ projectId: "p", name: "Mine" }], lastPlatformAdmin: false });
  });

  it("builds the join link when the server does not know its address", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { inviteToken: "abc", joinPath: "/join/abc", joinUrl: null, role: "operator", maxUses: 5, expiresAt: 1_700_000_000_000 }));
    const invite = await createInvite("p1", { role: "operator", maxUses: 5, expiresInDays: 7 });
    expect(invite.joinUrl).toBe("https://ce.example.org/join/abc");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ role: "operator", maxUses: 5, expiresInDays: 7 });
  });

  it("keeps the server's absolute join link", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { inviteToken: "abc", joinPath: "/join/abc", joinUrl: "https://cloud.org/join/abc", role: "admin", maxUses: 1, expiresAt: null }));
    const invite = await createInvite("p1", { role: "admin", maxUses: 1, expiresInDays: null });
    expect(invite.joinUrl).toBe("https://cloud.org/join/abc");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ role: "admin", maxUses: 1 });
  });

  it("overview with ISO dates and counts", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        name: "P",
        cep: { bytes: 2048, updatedAt: "2026-10-01T10:00:00.000Z" },
        members: 3,
        csvFiles: 2,
        plots: 150,
        records: { total: 10, submitted: 7, byOperator: [{ operator: "maria", total: 10, submitted: 7, lastModifiedOn: "2026-10-02T00:00:00Z" }] },
      }),
    );
    const overview = await getOverview("p1");
    expect(overview.cep).toEqual({ bytes: 2048, updatedAt: Date.parse("2026-10-01T10:00:00.000Z") });
    expect(overview.records.byOperator[0].lastModifiedOn).toBe(Date.parse("2026-10-02T00:00:00Z"));
    expect(overview.members).toBe(3);
  });

  it("toMillis / toCount / absoluteUrl", () => {
    expect(toMillis(5)).toBe(5);
    expect(toMillis("nonsense")).toBeNull();
    expect(toMillis(null)).toBeNull();
    expect(toCount([1, 2])).toBe(2);
    expect(toCount("4")).toBe(4);
    expect(toCount(undefined)).toBe(0);
    expect(absoluteUrl("/reset/x", "/", "https://a.org/")).toBe("https://a.org/reset/x");
    expect(absoluteUrl(null, "/join/y", "https://a.org")).toBe("https://a.org/join/y");
    expect(absoluteUrl("http://b.org/r", "/", "https://a.org")).toBe("http://b.org/r");
  });
});

describe("dividing plots", () => {
  const call = (i = 0) => {
    const [url, init] = fetchMock.mock.calls[i];
    return { url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined };
  };
  const state = { distribution: null, plotCount: 3, unassigned: 0, people: [] };

  it("reads a file's columns", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        plotCount: 120,
        hasHeader: true,
        separator: ";",
        columns: [
          { index: 0, name: "id", distinctCount: 120, values: null },
          { index: 4, name: null, distinctCount: 1, values: [{ value: "Oruro", count: "40" }] },
        ],
        nearby: { available: true, reason: null, withPlace: 118, withoutPlace: 2 },
      }),
    );
    expect(await getCsvColumns("p 1", "f1")).toEqual({
      plotCount: 120,
      hasHeader: true,
      separator: ";",
      columns: [
        { index: 0, name: "id", distinctCount: 120, values: null },
        { index: 4, name: null, distinctCount: 1, values: [{ value: "Oruro", count: 40 }] },
      ],
      nearby: { available: true, reason: null, withPlace: 118, withoutPlace: 2, srid: null },
    });
    expect(call()).toEqual({ url: "/v1/projects/p%201/csv-files/f1/columns", method: "GET", body: undefined });
  });

  it("gets, previews, applies and moves", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { ...state, moved: 5 }));
    await getDistribution("p1", "f1");
    expect(call(0)).toEqual({ url: "/v1/projects/p1/csv-files/f1/distribution", method: "GET", body: undefined });
    const even = { mode: "even" as const, people: ["u1"], order: "file" as const };
    await saveDistribution("p1", "f1", even, true);
    expect(call(1)).toEqual({ url: "/v1/projects/p1/csv-files/f1/distribution", method: "PUT", body: { ...even, dryRun: true } });
    await saveDistribution("p1", "f1", even);
    expect(call(2).body).toEqual(even);
    expect(await moveUnfinished("p1", "f1", "u1", "u2")).toMatchObject({ moved: 5, plotCount: 3 });
    expect(call(3)).toEqual({ url: "/v1/projects/p1/csv-files/f1/move-unfinished", method: "POST", body: { fromUserId: "u1", toUserId: "u2" } });
  });
});

describe("the quality figures", () => {
  const call = (i = 0) => {
    const [url, init] = fetchMock.mock.calls[i];
    return { url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined };
  };

  it("reads the figures with decisions, notes, margins and whether they are stale", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        plotsChecked: 25,
        plotsDiffering: 5,
        questions: [
          { key: "collect_integer_forest", label: "Forest %", kind: "number", compared: 25, agreeing: 25, rate: 1, margin: 10 },
          { key: "collect_code_land_use", label: "", kind: "choice", compared: 12, agreeing: 10, rate: null },
        ],
        confusions: [{ key: "collect_code_land_use", first: "F", check: "G", count: 5, plots: ["21", 22] }],
        people: [
          {
            username: "ana",
            asFirst: { compared: 25, agreeing: 20, rate: 0.8 },
            asChecker: { compared: 0, agreeing: 0, rate: null },
            weakest: [{ key: "collect_code_land_use", rate: null, compared: 12, differing: 2 }],
            personal: { asFirst: { compared: 1, agreeing: 1, rate: null }, confusions: [] },
          },
        ],
        weeks: [{ week: "2026-W44", compared: 25, agreeing: 20 }],
        differences: [{ plot: "21", first: { operator: "ana", recordKey: "21,1" }, check: { operator: "ben", recordKey: "21,2" }, fields: [{ key: "k", first: "F", check: null }] }],
        problems: [{ kind: "two_main", plot: "3", recordKey: "3,1", operator: "ana" }],
        problemsTotal: 1,
        beyondOutline: { count: 0, keys: [] },
        decisions: [{ plot: "21", decision: "check", comment: null, decidedBy: "boss", decidedAt: 1000 }],
        notes: [{ id: "n1", questionKey: "collect_code_land_use", firstValue: "F", checkValue: null, text: "Look at the canopy", updatedBy: null, updatedAt: 2000 }],
        settings: { margins: { "collect_entity_tree[*].real_height": 5, bad: "x" } },
        computedAt: 3000,
        stale: true,
      }),
    );
    const data = await getQuality("p1");
    expect(call().url).toBe("/v1/projects/p1/quality");
    expect(data.questions[1]).toEqual({ key: "collect_code_land_use", label: "collect_code_land_use", kind: "choice", compared: 12, agreeing: 10, rate: null, margin: null });
    expect(data.confusions[0].plots).toEqual(["21", "22"]);
    expect(data.people[0]).toEqual({
      username: "ana",
      asFirst: { compared: 25, agreeing: 20, rate: 0.8 },
      asChecker: { compared: 0, agreeing: 0, rate: null },
      weakest: [{ key: "collect_code_land_use", rate: null, compared: 12, differing: 2 }],
    });
    expect(data.differences[0].fields).toEqual([{ key: "k", first: "F", check: "" }]);
    // Without byAssessor (an older server): not said.
    expect(data.decisions).toEqual([{ plot: "21", decision: "check", comment: null, decidedBy: "boss", decidedAt: 1000, byAssessor: false }]);
    expect(data.notes[0]).toMatchObject({ id: "n1", firstValue: "F", checkValue: null, updatedAt: 2000 });
    expect(data.margins).toEqual({ "collect_entity_tree[*].real_height": 5 });
    expect(data).toMatchObject({ plotsChecked: 25, plotsDiffering: 5, problemsTotal: 1, computedAt: 3000, stale: true });
  });

  it("gives empty lists for a server that leaves them out", () => {
    expect(toQualityData({})).toMatchObject({ questions: [], confusions: [], people: [], weeks: [], differences: [], problems: [], decisions: [], notes: [], margins: {}, options: {}, stale: false, computedAt: null });
    expect(toQualityData({ options: { q: [{ code: "true", label: "Yes" }] } }).options).toEqual({ q: [{ code: "true", label: "Yes" }] });
  });

  it("says the figures are busy or failed in plain words", () => {
    expect(errorMessageKey(apiErrorFrom(503, { error: "busy" }))).toBe("quality.busy");
    expect(errorMessageKey(apiErrorFrom(500, { error: "quality_failed", reason: "The quality figures..." }))).toBe("quality.failed");
  });

  it("asks for the flags with their filters, and saves the very fast threshold alone", async () => {
    fetchMock.mockImplementation(async (_url) => {
      const url = String(_url);
      if (url.endsWith("/settings")) return jsonResponse(200, { margins: { a: 5 }, fastSeconds: 20 });
      return jsonResponse(200, { fastSeconds: 15, plots: 0, counts: {}, people: [], total: 0, flags: [], requiredQuestions: 0, computedAt: 1, stale: false });
    });
    expect(await saveFastSeconds("p1", 20)).toBe(20);
    expect(call(0)).toEqual({ url: "/v1/projects/p1/quality/settings", method: "PUT", body: { fastSeconds: 20 } });
    await getFlags("p1", { person: "ana b", kind: "very_fast" });
    expect(call(1).url).toBe("/v1/projects/p1/quality/flags?person=ana+b&kind=very_fast");
    await getFlags("p1", { person: null, kind: null });
    expect(call(2).url).toBe("/v1/projects/p1/quality/flags");
  });

  it("asks for the review queue with its filters and reads it; bulk decisions with a dry run first", async () => {
    fetchMock.mockImplementation(async (_url) => {
      const url = String(_url);
      if (url.includes("decisions:bulk")) return jsonResponse(200, { rule: "first_by_reviewer", decision: "first", count: 3, plots: ["1", "2", "3"], dryRun: url.includes("dryRun"), batch: url.includes("dryRun") ? null : "b-1" });
      return jsonResponse(200, {
        items: [
          {
            plot: "7",
            section: "resubmitted",
            people: ["ana", 5],
            differences: [{ plot: "7", first: { operator: "ana", recordKey: "7,1" }, check: { operator: "ben", recordKey: "7,2" }, fields: [{ key: "q", first: "F", check: "G" }] }, { plot: "7", first: { operator: "ana", recordKey: "7,1" }, check: { operator: "cy", recordKey: "7,2" }, fields: [], changed: true }],
            flags: [{ kind: "very_fast", plot: "7", operator: "ana", at: 5, details: { gapMs: 3000, previousPlot: "6" } }, { kind: "unknown", plot: "7" }],
            resubmitted: [{ plot: "7", operator: "ana", at: 9, decidedAt: 8 }],
            waiting: ["ben", 3],
            left: ["cy"],
            decision: { plot: "7", decision: "recheck", comment: null, decidedBy: "rita", decidedAt: 8, byAssessor: true },
          },
          { plot: "8", section: "odd" },
        ],
        next: "flag:5:8",
        total: 2,
        counts: { difference: 0, flag: 0, resubmitted: 1 },
        people: ["ana"],
        flagsCapped: true,
        excludedOwn: 2,
        labels: { q: "Land use" },
        options: { q: [{ code: "F", label: "Forest" }] },
        computedAt: 3,
        stale: false,
      });
    });
    const queue = await getReviewQueue("p1", { person: "ana b", kind: "very_fast" }, "difference::12");
    expect(call(0).url).toBe("/v1/projects/p1/quality/queue?person=ana+b&kind=very_fast&after=difference%3A%3A12");
    expect(queue.next).toBe("flag:5:8");
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      plot: "7",
      section: "resubmitted",
      people: ["ana"],
      flags: [{ kind: "very_fast", gapMs: 3000, previousPlot: "6" }],
      resubmitted: [{ operator: "ana", at: 9, decidedAt: 8 }],
      waiting: ["ben"],
      left: ["cy"],
      decision: { decision: "recheck", decidedBy: "rita" },
    });
    expect(queue.items[0].differences[0].fields).toEqual([{ key: "q", first: "F", check: "G" }]);
    expect(queue.items[0].differences[1]).toMatchObject({ fields: [], changed: true });
    expect(queue.items[0].differences[0].changed).toBe(false);
    expect(queue.items[0].decision?.byAssessor).toBe(true);
    expect(queue).toMatchObject({ total: 2, counts: { resubmitted: 1 }, flagsCapped: true, excludedOwn: 2, labels: { q: "Land use" }, options: { q: [{ code: "F", label: "Forest" }] } });
    await getReviewQueue("p1", { person: null, kind: null }, null);
    expect(call(1).url).toBe("/v1/projects/p1/quality/queue");
    expect(await bulkDecisions("p1", "first_by_reviewer", true)).toEqual({ decision: "first", count: 3, plots: ["1", "2", "3"], batch: null });
    expect(call(2)).toEqual({ url: "/v1/projects/p1/quality/decisions:bulk?dryRun=1", method: "POST", body: { rule: "first_by_reviewer" } });
    expect((await bulkDecisions("p1", "first_by_reviewer", false)).batch).toBe("b-1");
    expect(call(3)).toEqual({ url: "/v1/projects/p1/quality/decisions:bulk", method: "POST", body: { rule: "first_by_reviewer" } });
  });

  it("searches plots and reads a plot's page", async () => {
    fetchMock.mockImplementation(async (_url) => {
      const url = String(_url);
      if (url.includes("/plots/search")) return jsonResponse(200, { plots: [{ plot: "17,2025", name: "17", files: [{ id: "f1", filename: "a.csv" }, { id: 3 }] }, { name: "no plot" }], more: true });
      return jsonResponse(200, {
        plot: "1",
        name: "1",
        files: [{ id: "f1", filename: "a.csv", divided: true, main: ["ana"], copies: ["ben", 4] }, { id: "f2", filename: "b.csv", divided: false }],
        records: [
          { operator: "ana", recordKey: "1,1", round: "1", assessment: "main", submitted: true, deleted: false, modifiedOn: 5, receivedAt: 6, answers: { q: "F", n: 3 } },
          { operator: "ben", recordKey: "1,2", round: "2", assessment: "odd", submitted: false, deleted: true, modifiedOn: "x" },
        ],
        questions: [{ key: "q", label: "Land use" }, { key: "n" }],
        labels: { q: "Land use" },
        options: { q: [{ code: "F", label: "Forest" }] },
        decision: { plot: "1", decision: "check", comment: "G", decidedBy: "rita", decidedAt: 8, byAssessor: false },
        ownPlot: true,
        flags: [{ kind: "very_fast", plot: "1", operator: "ana", at: 5, details: { gapMs: 3000, previousPlot: "0" } }],
        differences: [{ plot: "1", first: { operator: "ana", recordKey: "1,1" }, check: { operator: "ben", recordKey: "1,2" }, fields: [{ key: "q", first: "F", check: "G" }] }],
        figures: { computedAt: 3, stale: true },
        place: { lat: -10, lon: 20, name: "1" },
        outline: { kind: "square", sideMeters: 70 },
      });
    });
    const found = await searchPlots("p1", " 17 ");
    expect(call(0).url).toBe("/v1/projects/p1/plots/search?q=17");
    expect(found).toEqual({ plots: [{ plot: "17,2025", name: "17", files: [{ id: "f1", filename: "a.csv" }] }], more: true });
    const page = await getPlotPage("p1", "1,2025/x");
    expect(call(1).url).toBe("/v1/projects/p1/plots/1%2C2025%2Fx");
    expect(page.files).toEqual([
      { id: "f1", filename: "a.csv", divided: true, main: ["ana"], copies: ["ben"] },
      // A reviewer's page names the files only.
      { id: "f2", filename: "b.csv", divided: false, main: null, copies: null },
    ]);
    expect(page.records[0]).toEqual({ operator: "ana", recordKey: "1,1", round: "1", assessment: "main", submitted: true, deleted: false, modifiedOn: 5, receivedAt: 6, answers: { q: "F", n: "3" } });
    expect(page.records[1]).toMatchObject({ assessment: "other", submitted: false, deleted: true, modifiedOn: null, answers: {} });
    expect(page.questions).toEqual([{ key: "q", label: "Land use" }, { key: "n", label: "n" }]);
    expect(page).toMatchObject({ plot: "1", name: "1", ownPlot: true, figures: { computedAt: 3, stale: true }, place: { lat: -10, lon: 20, name: "1" }, outline: { kind: "square", sideMeters: 70 }, unsupportedSrs: null });
    expect(page.decision).toMatchObject({ decision: "check", decidedBy: "rita", comment: "G" });
    expect(page.flags).toEqual([expect.objectContaining({ kind: "very_fast", gapMs: 3000 })]);
    expect(page.differences?.[0]).toMatchObject({ changed: false, fields: [{ key: "q", first: "F", check: "G" }] });
    expect(page.options).toEqual({ q: [{ code: "F", label: "Forest" }] });
    // No figures at hand: no flags nor differences, rather than none.
    fetchMock.mockImplementation(async () => jsonResponse(200, { plot: "2", flags: null, differences: null, figures: null, place: null }));
    expect(await getPlotPage("p1", "2")).toMatchObject({ flags: null, differences: null, figures: null, place: null, decision: null, records: [], files: [] });
    // Nothing typed: nothing asked.
    expect(await searchPlots("p1", "  ")).toEqual({ plots: [], more: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("map tiles: the server's when usable, else OpenStreetMap's", () => {
    const tiles = { url: "https://t.example.org/{z}/{x}/{y}.png", attribution: "© Example", attributionUrl: "https://example.org/a", maxZoom: 17 };
    expect(toMapTiles(tiles)).toEqual(tiles);
    expect(toMapTiles({ ...tiles, attributionUrl: "javascript:x", maxZoom: 99 })).toEqual({ ...tiles, attributionUrl: null, maxZoom: 19 });
    for (const bad of [undefined, null, { ...tiles, url: "javascript:alert(1)/{z}/{x}/{y}" }, { ...tiles, url: "https://t.example.org/{z}/{x}.png" }, { ...tiles, attribution: " " }]) {
      expect(toMapTiles(bad)).toEqual(OSM_TILES);
    }
  });

  it("reads the map page by page into typed arrays, and again from the start when it changed", async () => {
    const page = (offset: number, version = "v1") => ({
      version,
      offset,
      total: 3,
      next: offset === 0 ? 2 : null,
      points: offset === 0 ? [[1.5, 2.5, 2, 0], [3, 4, 5, 9]] : [[-5, 6, 0, -1]],
      plots: offset === 0 ? ["1", "2"] : ["3"],
      statuses: ["notStarted", "started", "submitted", "accepted", "recheck", "differs"],
      counts: [2, 0, 1, 0, 0, 1],
      notOnMap: 1,
      files: [{ id: "f", filename: "a.csv", plots: 5, onMap: 3 }],
      people: ["ana"],
      holders: [["ana"]],
      figures: null,
      asOf: null,
    });
    const answers = [page(0), jsonResponse(409, { error: "map_changed" }), page(0, "v2"), page(2, "v2")].map((a) => (a instanceof Response ? a : jsonResponse(200, a)));
    fetchMock.mockImplementation(async () => answers.shift()!);
    const progress: number[] = [];
    const map = await getMapPlots("p1", { file: "f", person: "ana" }, (loaded) => progress.push(loaded));
    expect(call(0).url).toBe("/v1/projects/p1/map/plots?offset=0&file=f&person=ana");
    expect(call(1).url).toBe("/v1/projects/p1/map/plots?offset=2&file=f&person=ana&version=v1");
    // The server no longer had the map: read again from the start.
    expect(call(2).url).toBe("/v1/projects/p1/map/plots?offset=0&file=f&person=ana");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(progress).toEqual([2, 2, 3]);
    expect(map.version).toBe("v2");
    expect([...map.lat]).toEqual([1.5, 3, -5]);
    expect([...map.lon]).toEqual([2.5, 4, 6]);
    expect([...map.status]).toEqual([2, 5, 0]);
    // A holder index the answer does not have is nobody.
    expect([...map.holder]).toEqual([0, -1, -1]);
    expect(map.plots).toEqual(["1", "2", "3"]);
    expect(map.names).toBeNull();
    expect(map.counts).toEqual({ notStarted: 2, started: 0, submitted: 1, accepted: 0, recheck: 0, differs: 1, resubmitted: 0 });
    expect(map).toMatchObject({ total: 3, notOnMap: 1, people: ["ana"], holders: [["ana"]], figures: null, asOf: null, unsupportedSrs: null });
    expect(map.files).toEqual([{ id: "f", filename: "a.csv", plots: 5, onMap: 3 }]);
    // A reviewer's map names nobody; status codes are read by their names.
    const reviewer = addMapPage(null, { version: "x", offset: 0, total: 1, points: [[1, 2, 0, 0]], plots: ["9"], statuses: ["differs"], counts: [4], people: null, holders: null, unsupportedSrs: "EPSG:32633" });
    expect(reviewer).toMatchObject({ people: null, holders: null, unsupportedSrs: "EPSG:32633" });
    expect([...reviewer.status]).toEqual([5]);
    expect([...reviewer.holder]).toEqual([-1]);
    expect(reviewer.counts.differs).toBe(4);
    // The ids the collector sees, when the server sends them.
    expect(addMapPage(null, { version: "x", offset: 0, total: 2, points: [[1, 2, 0, 0], [1, 2, 0, 0]], plots: ["1,2025", "2,2025"], names: ["1", 7] }).names).toEqual(["1", "2,2025"]);
  });

  it("never gives a map in part: when the map changes on every page, it says so", async () => {
    let n = 0;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("version=")) return jsonResponse(409, { error: "map_changed", reason: "gone" });
      n += 1;
      return jsonResponse(200, { version: `v${n}`, offset: 0, total: 3, next: 2, points: [[1, 2, 0, -1], [1, 2, 0, -1]], plots: ["1", "2"] });
    });
    const error = await getMapPlots("p1", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("map_changed");
    expect(errorMessageKey(error)).toBe("map.changed");
    // The first try and three more.
    expect(n).toBe(4);
  });

  it("saves margins, decisions and notes, and asks where plots are", async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "DELETE") return new Response(null, { status: 404 });
      const url = String(_url);
      if (url.endsWith("/settings")) return jsonResponse(200, { margins: { a: 5 } });
      if (url.includes("/decisions/")) return jsonResponse(200, { plot: "1,2", decision: "recheck", comment: "look", decidedBy: null, decidedAt: 5 });
      if (url.endsWith("/places")) return jsonResponse(200, { places: [{ plot: "1", lat: -12.5, lon: 30, name: "1" }, { plot: "2", lat: "x", lon: 1 }], outline: { kind: "square", sideMeters: 70 } });
      return jsonResponse(201, { id: "n2", questionKey: "q", firstValue: null, checkValue: null, text: "t" });
    });
    expect(await saveQualityMargins("p1", { a: 5 })).toEqual({ a: 5 });
    expect(call(0)).toEqual({ url: "/v1/projects/p1/quality/settings", method: "PUT", body: { margins: { a: 5 } } });
    expect(await setQualityDecision("p1", "1,2", "recheck", "  look ")).toMatchObject({ plot: "1,2", decision: "recheck", comment: "look" });
    expect(call(1)).toEqual({ url: "/v1/projects/p1/quality/decisions/1%2C2", method: "PUT", body: { decision: "recheck", comment: "look" } });
    await setQualityDecision("p1", "3", "first", " ");
    expect(call(2).body).toEqual({ decision: "first" });
    // A decision or note already gone counts as removed.
    await deleteQualityDecision("p1", "1,2");
    expect(call(3)).toMatchObject({ url: "/v1/projects/p1/quality/decisions/1%2C2", method: "DELETE" });
    const note = { questionKey: "q", firstValue: null, checkValue: null, text: "t" };
    expect(await createGuidanceNote("p1", note)).toMatchObject({ id: "n2", text: "t" });
    expect(call(4)).toEqual({ url: "/v1/projects/p1/quality/notes", method: "POST", body: note });
    await updateGuidanceNote("p1", "n2", note);
    expect(call(5)).toMatchObject({ url: "/v1/projects/p1/quality/notes/n2", method: "PUT" });
    await deleteGuidanceNote("p1", "n2");
    expect(call(6)).toMatchObject({ url: "/v1/projects/p1/quality/notes/n2", method: "DELETE" });
    expect(await getPlotPlaces("p1", ["1", "2"])).toEqual({ places: [{ plot: "1", lat: -12.5, lon: 30, name: "1" }], outline: { kind: "square", sideMeters: 70 }, unsupportedSrs: null });
    expect(call(7)).toEqual({ url: "/v1/projects/p1/quality/places", method: "POST", body: { plots: ["1", "2"] } });
    expect(await getPlotPlaces("p1", [])).toEqual({ places: [], outline: { kind: "place" }, unsupportedSrs: null });
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("says when the survey's coordinates are not latitude and longitude", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { places: [], unsupportedSrs: "EPSG:32633" }));
    expect(await getPlotPlaces("p1", ["1"])).toEqual({ places: [], outline: { kind: "place" }, unsupportedSrs: "EPSG:32633" });
  });
});

describe("the project file and round", () => {
  const added = { state: "added", refusal: null, keyCount: 2, roundIndex: 1, roundCodes: [{ code: "1", label: "First assessment" }, { code: "2", label: "Re-assessment" }], reassessmentCode: "2" };

  /** A minimal XMLHttpRequest that answers every upload with one status and body. */
  function fakeXhr(status: number, body: unknown) {
    const sent: { method: string; url: string; headers: Record<string, string> }[] = [];
    class FakeXhr {
      status = 0;
      responseText = "";
      upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private request = { method: "", url: "", headers: {} as Record<string, string> };
      open(method: string, url: string) {
        this.request.method = method;
        this.request.url = url;
      }
      setRequestHeader(name: string, value: string) {
        this.request.headers[name] = value;
      }
      send() {
        sent.push(this.request);
        this.status = status;
        this.responseText = JSON.stringify(body);
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    return sent;
  }

  it("an upload returns what the server did about round", async () => {
    const sent = fakeXhr(200, { ok: true, bytes: 10, round: added });
    expect(await uploadCep("p 1", new Blob(["zip"]))).toEqual({ ...added, note: null });
    expect(sent[0]).toMatchObject({ method: "PUT", url: "/v1/projects/p%201/cep", headers: { "content-type": "application/zip" } });
  });

  it("an older server's upload answer has no round", async () => {
    fakeXhr(200, { ok: true, bytes: 10 });
    expect(await uploadCep("p1", new Blob(["zip"]))).toBeNull();
  });

  it.each([
    [409, "round_removed", "error.roundRemoved"],
    [409, "note_removed", "error.noteRemoved"],
    [409, "round_codes_changed", "error.roundCodesChanged"],
    [409, "key_shape_changed", "error.keyShapeChanged"],
    [409, "plots_divided", "error.plotsDivided"],
    [409, "note_column_in_file", "error.noteColumnInFile"],
    [413, "too_large", "error.cepTooLarge"],
    [413, "storage_limit_reached", "error.storageLimitReached"],
  ])("a %i %s upload becomes its own sentence", async (status, code, key) => {
    fakeXhr(status, { error: code, reason: "in English" });
    const error = await uploadCep("p1", new Blob(["zip"])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).reason).toBe("in English");
    expect(errorMessageKey(error)).toBe(key);
    expect(CATALOGUES.en[errorMessageKey(error)]).toBeTruthy();
  });

  it("reads the round info, or null before any upload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, added)).mockResolvedValueOnce(jsonResponse(200, null));
    expect(await getRoundInfo("p1")).toEqual({ ...added, note: null });
    expect(await getRoundInfo("p1")).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("/v1/projects/p1/round");
  });

  it("normalises a round info", () => {
    expect(toRoundInfo({ state: "odd", roundCodes: [{ code: 2020 }, { label: "no code" }], keyCount: "2", roundIndex: 1 })).toEqual({
      state: "none",
      refusal: null,
      keyCount: 2,
      roundIndex: 1,
      roundCodes: [{ code: "2020", label: "" }],
      reassessmentCode: null,
      note: null,
    });
    expect(toRoundInfo({ state: "none", refusal: "several_keys" })?.refusal).toBe("several_keys");
    expect(toRoundInfo("nope")).toBeNull();
    // The coordinator's note (Task 16): absent from older servers and older infos.
    expect(toRoundInfo({ state: "added", note: { state: "added", refusal: null, column: 9 } })?.note).toEqual({ state: "added", refusal: null, column: 9 });
    expect(toRoundInfo({ state: "added", note: { state: "odd", refusal: "records_exist", column: "9" } })?.note).toEqual({ state: "none", refusal: "records_exist", column: null });
    expect(toRoundInfo({ state: "added", note: "nope" })?.note).toBeNull();
  });

  it("saves the re-assessment code, or none", async () => {
    const own = { ...added, state: "own", reassessmentCode: "3" };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, own)).mockResolvedValueOnce(jsonResponse(200, { ...own, reassessmentCode: null }));
    expect((await setReassessmentCode("p1", "3"))?.reassessmentCode).toBe("3");
    expect((await setReassessmentCode("p1", null))?.reassessmentCode).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect([url, init?.method, JSON.parse(init?.body as string)]).toEqual(["/v1/projects/p1/round", "PUT", { reassessmentCode: "3" }]);
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ reassessmentCode: null });
  });

  it("downloads the uploaded file, or the served one when the server kept no separate original", async () => {
    fetchMock.mockResolvedValueOnce(new Response("original", { status: 200 }));
    expect(await (await downloadOriginalCep("p1")).text()).toBe("original");
    expect(fetchMock.mock.calls[0][0]).toBe("/v1/projects/p1/cep/original");

    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not_found" })).mockResolvedValueOnce(new Response("served", { status: 200 }));
    expect(await (await downloadOriginalCep("p1")).text()).toBe("served");
    expect(fetchMock.mock.calls[2][0]).toBe("/v1/projects/p1/cep");

    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "forbidden" }));
    await expect(downloadOriginalCep("p1")).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("the AI assistant and the reports", () => {
  const call = (i = 0) => {
    const [url, init] = fetchMock.mock.calls[i];
    return { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined };
  };

  it("reads and sets the project's switch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { enabled: false, available: true }));
    expect(await getProjectAi("p1")).toEqual({ enabled: false, available: true });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { enabled: true, available: true }));
    expect(await setProjectAi("p1", true)).toEqual({ enabled: true, available: true });
    expect(call(1)).toEqual({ url: "/v1/projects/p1/ai", method: "PUT", body: { enabled: true } });
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "user_session_required", reason: "Sign in" }));
    const err = await setProjectAi("p1", true).catch((e: unknown) => e);
    expect(errorMessageKey(err)).toBe("ai.sessionRequired");
  });

  it("starts runs with the dashboard's language", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(202, { runId: "r1" }));
    expect(await startAiRun("p1", { kind: "report" }, "es")).toBe("r1");
    await startAiRun("p1", { kind: "follow_up", parentRunId: "r1", findingIndex: 2, action: "draft_note" }, "fr");
    await startAiRun("p1", { kind: "question", parentRunId: "r1", question: "Why?" }, "pt");
    expect(call(0)).toEqual({ url: "/v1/projects/p1/ai/runs", method: "POST", body: { kind: "report", language: "es" } });
    expect(call(1).body).toEqual({ kind: "follow_up", parentRunId: "r1", findingIndex: 2, action: "draft_note", language: "fr" });
    expect(call(2).body).toEqual({ kind: "question", parentRunId: "r1", question: "Why?", language: "pt" });
  });

  it("keeps a limit's details on the error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: "ai_daily_limit", limit: "reports", resetsAt: null, reason: "x" }));
    const err = await startAiRun("p1", { kind: "report" }, "en").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).details).toMatchObject({ limit: "reports", resetsAt: null });
  });

  it("lists runs newest first as the server gives them", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        runs: [
          { id: "r2", kind: "follow_up", status: "running", startedAt: 2000, finishedAt: null, startedBy: "boss", tokens: 5, parentRunId: "r1", findingIndex: 0, action: "explain", errorCode: null },
          { id: "r1", kind: "report", status: "done", startedAt: "1970-01-01T00:00:01.000Z", startedBy: null, tokens: "12" },
        ],
      }),
    );
    const runs = await listAiRuns("p1");
    expect(call().url).toBe("/v1/projects/p1/ai/runs");
    expect(runs[0]).toEqual({
      id: "r2",
      kind: "follow_up",
      status: "running",
      startedAt: 2000,
      finishedAt: null,
      startedBy: "boss",
      tokens: 5,
      parentRunId: "r1",
      findingIndex: 0,
      action: "explain",
      errorCode: null,
    });
    expect(runs[1]).toMatchObject({ id: "r1", kind: "report", status: "done", startedAt: 1000, startedBy: null, tokens: 12, parentRunId: null, action: null });
  });

  it("reads a report run, its progress and a failed or refused run", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        id: "r1",
        kind: "report",
        status: "done",
        startedAt: 1000,
        progress: { tools: ["get_agreement", 7] },
        result: {
          summary: "Land use is mixed up.",
          findings: [{ title: "T", explanation: "E", cause: "weird", questions: ["q1"], persons: ["ana"], plots: ["21"], suggestedNote: null }, "junk"],
          recheckPlots: ["21"],
          surveyChanges: [{ question: "q1", suggestion: "Reword" }],
        },
        error: null,
        refusal: null,
      }),
    );
    const run = await getAiRun("p1", "r1");
    expect(call().url).toBe("/v1/projects/p1/ai/runs/r1");
    expect(run.tools).toEqual(["get_agreement", "7"]);
    expect(run.report).toEqual({
      summary: "Land use is mixed up.",
      findings: [{ title: "T", explanation: "E", cause: "other", questions: ["q1"], persons: ["ana"], plots: ["21"], suggestedNote: null }],
      recheckPlots: ["21"],
      surveyChanges: [{ question: "q1", suggestion: "Reword" }],
    });
    expect(run.answer).toBeNull();

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "r3", kind: "question", status: "done", question: "Why ana?", result: { text: "Because", plots: ["21"], note: "Look" } }),
    );
    const answer = await getAiRun("p1", "r3");
    expect(answer).toMatchObject({ question: "Why ana?", report: null, answer: { text: "Because", plots: ["21"], note: "Look" } });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "r4", kind: "report", status: "failed", errorCode: "ai_timeout", error: { code: "ai_timeout", message: "x" } }));
    expect(await getAiRun("p1", "r4")).toMatchObject({ status: "failed", errorCode: "ai_timeout", report: null });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "r5", kind: "question", status: "refused", errorCode: "off_topic", refusal: "Only quality" }));
    expect(await getAiRun("p1", "r5")).toMatchObject({ status: "refused", errorCode: "off_topic", refusal: "Only quality" });
  });

  it("reads the server's AI settings and its use this month, by project id", async () => {
    expect(toServerSettings({ aiEnabled: true, aiReportsPerDay: 0, aiMonthlyTokens: 9, aiConfigured: true })).toMatchObject({
      aiEnabled: true,
      aiReportsPerDay: 0,
      aiFollowUpsPerDay: DEFAULT_SERVER_SETTINGS.aiFollowUpsPerDay,
      aiMonthlyTokens: 9,
      aiConfigured: true,
    });
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        month: "2026-10",
        projects: [{ projectId: "p1", runs: 3, reports: 1, followUps: 1, questions: 1, failed: 0, refused: 1, inputTokens: 10, outputTokens: 5, tokens: 15 }],
        totals: { runs: 3, reports: 1, followUps: 1, questions: 1, failed: 0, refused: 1, inputTokens: 10, outputTokens: 5, tokens: 15 },
      }),
    );
    const usage = await getAiUsage();
    expect(call().url).toBe("/v1/admin/ai-usage");
    expect(usage.month).toBe("2026-10");
    expect(usage.projects[0]).toEqual({ projectId: "p1", runs: 3, reports: 1, followUps: 1, questions: 1, failed: 0, refused: 1, tokens: 15 });
    expect(usage.totals.tokens).toBe(15);
  });

  it("reads a member disabled by the server owner: a flag in the member list, a status on the People tab", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { members: [{ userId: "u1", username: "maria", role: "operator", disabled: true }, { userId: "u2", username: "ana", role: "operator" }] }));
    const members = await listMembers("p1");
    expect(members.map((m) => m.disabled)).toEqual([true, false]);
    expect(toPersonRow({ userId: "u1", username: "maria", status: { kind: "disabled" } }).status).toEqual({ kind: "disabled", days: null, level: null });
  });

  it("reads the server owner's panel, and disables and enables an account", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        asOf: 5,
        users: { total: 3, disabled: 1, platformAdmins: 1, active: 2, signupsByWeek: [{ week: "2026-W45", start: 1, count: 2 }] },
        projects: { total: 2, active: 1, storageBytes: 30, largest: [{ projectId: "p1", storageBytes: 20, name: "never shown" }] },
        records: { received: 4, receivedByDay: [{ day: 0, count: 4 }] },
        database: { backend: "postgres", sizeBytes: 9000, version: "16.4", migrations: { applied: 18, shipped: 18, latest: "018_platform.sql", newestAppliedAt: 7, missing: [] } },
        server: { version: "0.1.0", startedAt: 3 },
        security: { since: 3, totals: { failedLogins: 2, rateLimited: 1 }, hours: [{ hour: 0, failedLogins: 2, rateLimited: 1 }] },
      }),
    );
    const o = await getServerOverview();
    expect(call().url).toBe("/v1/admin/overview");
    expect(o.projects.largest).toEqual([{ projectId: "p1", storageBytes: 20 }]);
    expect(o.database).toEqual({ backend: "postgres", sizeBytes: 9000, version: "16.4", migrations: { applied: 18, shipped: 18, latest: "018_platform.sql", newestAppliedAt: 7, missing: [] } });
    expect(o.security.totals).toEqual({ failedLogins: 2, rateLimited: 1 });
    // The memory store has no database figures.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { database: { backend: "memory", sizeBytes: null, version: null, migrations: null } }));
    expect((await getServerOverview()).database).toEqual({ backend: "memory", sizeBytes: null, version: null, migrations: null });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { userId: "u1", username: "maria", disabledAt: 100, disabledBy: "owner" } }));
    expect(await setUserDisabled("u1", true)).toMatchObject({ userId: "u1", disabledAt: 100, disabledBy: "owner" });
    expect(call(2)).toEqual({ url: "/v1/admin/users/u1/disable", method: "POST", body: undefined });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { userId: "u1", username: "maria", disabledAt: null, disabledBy: null } }));
    expect(await setUserDisabled("u1", false)).toMatchObject({ disabledAt: null, disabledBy: null });
    expect(call(3).url).toBe("/v1/admin/users/u1/enable");
    for (const [code, key] of [["own_account", "error.ownAccount"], ["last_enabled_admin", "error.lastEnabledAdmin"], ["account_disabled", "error.accountDisabled"]]) {
      expect(errorMessageKey(new ApiError(409, code, null, {}))).toBe(key);
    }
  });

  it("reads a member's own report and the team report", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        username: "ana",
        minChecks: 20,
        asFirst: { checks: 30, agreeing: 24, rate: 0.8 },
        confusions: [{ key: "q1", label: "Land use", first: "F", check: "G", checks: 3, plots: ["1", 2], notes: [{ id: "n1", questionKey: "q1", firstValue: "F", checkValue: null, text: "Look" }] }],
        computedAt: 5000,
        stale: false,
        options: { q1: [{ code: "F", label: "Forest" }, { code: "G" }, "junk"], bad: "x" },
      }),
    );
    const mine = await getMyQuality("p1");
    // The answer options of the choice questions, to show labels instead of codes.
    expect(mine.options).toEqual({ q1: [{ code: "F", label: "Forest" }, { code: "G", label: "" }] });
    expect(call(0).url).toBe("/v1/projects/p1/my-quality");
    expect(mine.asFirst).toEqual({ compared: 30, agreeing: 24, rate: 0.8 });
    expect(mine.confusions[0]).toEqual({
      key: "q1",
      label: "Land use",
      first: "F",
      check: "G",
      checks: 3,
      plots: ["1", "2"],
      notes: [{ id: "n1", questionKey: "q1", firstValue: "F", checkValue: null, text: "Look" }],
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        minChecks: 20,
        plotsChecked: 40,
        plotsDiffering: 6,
        questions: [
          { key: "q1", label: "Land use", kind: "choice", checks: 40, agreeing: 34, rate: 0.85 },
          { key: "q2", label: "", kind: "number", checks: 3, agreeing: 3, rate: null, margin: 5 },
        ],
        confusions: [],
        notes: [{ id: "n1", questionKey: "q1", firstValue: null, checkValue: null, text: "Look" }],
        computedAt: 5000,
        stale: true,
        options: { q1: [{ code: "F", label: "Forest" }] },
      }),
    );
    const team = await getTeamReport("p1");
    expect(team.options).toEqual({ q1: [{ code: "F", label: "Forest" }] });
    expect(call(1).url).toBe("/v1/projects/p1/quality/team-report");
    expect(team.questions[1]).toEqual({ key: "q2", label: "q2", kind: "number", compared: 3, agreeing: 3, rate: null, margin: 5 });
    expect(team).toMatchObject({ plotsChecked: 40, plotsDiffering: 6, stale: true, computedAt: 5000 });
    expect(team.notes).toHaveLength(1);
  });
});

describe("the Collect Earth backup", () => {
  const url = (i = 0) => String(fetchMock.mock.calls[i][0]);

  it("reads what each choice would hold; all rounds is null without the round key", async () => {
    const counts = { records: 4, drafts: 1, reference: 0, otherRounds: 1, sameKey: 2, sameKeyReference: 0, sameKeyExamples: ["1,1", 7] };
    fetchMock.mockResolvedValue(jsonResponse(200, { projectFile: true, roundKey: true, roundState: "added", note: true, rounds: { "1": counts, all: { ...counts, records: "x" } } }));
    const summary = await getBackupSummary("p 1");
    expect(url()).toBe("/v1/projects/p%201/exports/collect-backup/summary");
    expect(summary).toEqual({
      projectFile: true,
      roundKey: true,
      note: true,
      first: { ...counts, sameKeyExamples: ["1,1"] },
      all: { ...counts, records: 0, sameKeyExamples: ["1,1"] },
    });
    fetchMock.mockResolvedValue(jsonResponse(200, { projectFile: true, roundKey: false, rounds: { "1": counts, all: counts } }));
    expect((await getBackupSummary("p1")).all).toBeNull();
  });

  it("downloads the zip with the name the server gave it; a survey without round is told as such", async () => {
    fetchMock.mockResolvedValue(
      new Response("PK", { status: 200, headers: { "content-type": "application/zip", "content-disposition": "attachment; filename=\"a.zip\"; filename*=UTF-8''Proyecto%20%C3%B1-collect-earth-backup-all-rounds.zip" } }),
    );
    const { blob, filename } = await downloadCollectBackup("p1", "all");
    expect(url()).toBe("/v1/projects/p1/exports/collect-backup?rounds=all");
    expect(filename).toBe("Proyecto ñ-collect-earth-backup-all-rounds.zip");
    expect(await blob.text()).toBe("PK");
    fetchMock.mockResolvedValue(jsonResponse(409, { error: "no_round_key", reason: "no round" }));
    const error = await downloadCollectBackup("p1", "all").catch((e: unknown) => e);
    expect(errorMessageKey(error)).toBe("backup.noRoundKey");
    fetchMock.mockResolvedValue(jsonResponse(409, { error: "no_project_file" }));
    expect(errorMessageKey(await downloadCollectBackup("p1", "1").catch((e: unknown) => e))).toBe("backup.noProjectFile");
  });
});

describe("activity: the log, the weekly summary, the downloads and the bell", () => {
  const url = (i = 0) => String(fetchMock.mock.calls[i][0]);

  it("asks for a page of the log with its filters and cursor, and reads its rows", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        items: [
          { type: "record", id: "r2", at: 2000, receivedAt: 2500, person: "maria", change: "submitted", plot: "17", name: "17", assessment: "check", round: "2" },
          { type: "audit", id: "a1", at: 1000, person: null, action: "member.removed", details: { userId: "u1", nested: { no: 1 } }, plotName: null },
          { type: "other" },
        ],
        next: "1000.1_e",
        people: { u1: { name: "ben", removed: true } },
        files: { f1: "north.csv", f2: null },
        persons: ["maria", "owner"],
      }),
    );
    const page = await getActivity("p 1", { person: "maria", kind: "submitted", from: 10, to: 20.4, cursor: "s_s", limit: 50 });
    expect(url()).toBe("/v1/projects/p%201/activity?person=maria&kind=submitted&from=10&to=20&cursor=s_s&limit=50");
    expect(page.items).toEqual([
      { type: "record", id: "r2", at: 2000, receivedAt: 2500, person: "maria", change: "submitted", plot: "17", name: "17", assessment: "check", round: "2" },
      { type: "audit", id: "a1", at: 1000, person: null, action: "member.removed", details: { userId: "u1" }, plotName: null },
    ]);
    expect(page).toMatchObject({ next: "1000.1_e", people: { u1: { name: "ben", removed: true } }, files: { f1: "north.csv", f2: null }, persons: ["maria", "owner"] });
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [], next: null }));
    await getActivity("p1", { kind: "all" });
    expect(url(1)).toBe("/v1/projects/p1/activity");
  });

  it("the weekly summary of a week, or of this week", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        week: "2026-W44",
        timeZone: "Europe/Rome",
        start: "2026-10-26",
        end: "2026-11-01",
        current: false,
        asOf: null,
        progress: { days: [{ date: "2026-10-26", submitted: 2, checks: 1 }], submitted: 2, checks: 1, before: 0, byEnd: 2, totals: { plots: 30, submitted: 2 } },
        people: [{ userId: "u1", username: "maria", role: "operator", submitted: 2, checks: 0, status: { kind: "working" }, plots: { assigned: 30, submitted: 2, started: 0, remaining: 28, done: 0.07 } }],
        quality: { available: true, computedAt: 5, stale: false, week: { compared: 1, agreeing: 0, rate: null }, overall: null, decided: { first: 1, check: 0, recheck: 0, total: 1 }, flags: { counts: { very_fast: 2 }, total: 2 } },
      }),
    );
    const w = await getWeekly("p1", "2026-W44", "Europe/Rome");
    expect(url()).toBe("/v1/projects/p1/weekly?tz=Europe%2FRome&week=2026-W44");
    expect(w.progress).toMatchObject({ submitted: 2, checks: 1, byEnd: 2, totals: { plots: 30, submitted: 2, assigned: 0 } });
    expect(w.people[0]).toMatchObject({ username: "maria", submitted: 2, status: { kind: "working" }, plots: { assigned: 30, remaining: 28 } });
    expect(w.quality).toMatchObject({ available: true, week: { compared: 1, agreeing: 0, rate: null }, overall: null, decided: { total: 1 }, flags: { total: 2, counts: { very_fast: 2 } } });
    await getWeekly("p1", null, "UTC");
    expect(url(1)).toBe("/v1/projects/p1/weekly?tz=UTC");
  });

  it("the rows of each download; the differences say when the figures are not at hand", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { kind: "daily", today: "2026-11-02", rows: [{ date: "2026-10-26", person: "maria", plots: 2, checks: "x", drafts: 3 }] }));
    const daily = await getExport("p1", "daily", "UTC");
    expect(url()).toBe("/v1/projects/p1/exports/daily?tz=UTC");
    expect(daily).toEqual({ kind: "daily", today: "2026-11-02", rows: [{ date: "2026-10-26", person: "maria", plots: 2, checks: 0, submittedAgain: 0, drafts: 3, reopened: 0, deleted: 0 }] });
    fetchMock.mockResolvedValue(jsonResponse(200, { today: "2026-11-02", rows: [{ plot: "1", name: "1", decision: "check", comment: null, decidedBy: "ana", decidedAt: 9, byAssessor: false, bulk: true }] }));
    expect((await getExport("p1", "decisions", "UTC")).rows).toEqual([{ plot: "1", name: "1", decision: "check", comment: null, decidedBy: "ana", decidedAt: 9, byAssessor: false, bulk: true }]);
    fetchMock.mockResolvedValue(jsonResponse(409, { error: "no_figures", reason: "open the Quality tab first" }));
    await expect(getExport("p1", "differences", "UTC")).rejects.toMatchObject({ status: 409, code: "no_figures" });
  });

  it("the bell: items with their read state; marking some or all read", async () => {
    const body = { items: [{ key: "quiet:1", read: false, item: { kind: "quiet", count: 2, quietDays: 3, people: [{ username: "ana", lastSyncAt: 5 }] } }, { key: "x:1", read: false, item: { kind: "nope", count: 1 } }] };
    fetchMock.mockImplementation(async () => jsonResponse(200, body));
    const bell = await getAttention("p1");
    expect(bell.unread).toBe(1);
    expect(bell.items[0]).toMatchObject({ key: "quiet:1", read: false, item: { kind: "quiet", count: 2, quietDays: 3, people: [{ username: "ana", lastSyncAt: 5 }] } });
    await markAttentionRead("p1", ["quiet:1"]);
    expect(url(1)).toBe("/v1/projects/p1/attention/read");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]!.body))).toEqual({ keys: ["quiet:1"] });
    await markAttentionRead("p1", "all");
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]!.body))).toEqual({ all: true });
  });
});

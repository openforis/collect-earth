import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  absoluteUrl,
  ApiError,
  apiErrorFrom,
  changePassword,
  createInvite,
  deleteAccount,
  deleteProject,
  errorMessageKey,
  getAccountDeletion,
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

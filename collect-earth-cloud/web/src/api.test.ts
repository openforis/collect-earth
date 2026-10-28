import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  absoluteUrl,
  ApiError,
  apiErrorFrom,
  changePassword,
  createInvite,
  errorMessageKey,
  getOverview,
  getServerInfo,
  listProjects,
  login,
  setUnauthorizedHandler,
  toCount,
  toMillis,
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
    expect(await getServerInfo()).toEqual({ needsSetup: false, signupOpen: false, projectCreation: "platform-admins", version: null });
  });

  it("server info", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { needsSetup: true, signupOpen: true, projectCreation: "anyone", version: "0.2.0" }));
    expect(await getServerInfo()).toEqual({ needsSetup: true, signupOpen: true, projectCreation: "anyone", version: "0.2.0" });
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

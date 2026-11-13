import { describe, expect, it } from "vitest";
import type { ServerActivityEntry } from "./api";
import { CATALOGUES, translator } from "./i18n";
import { activitySentence, SETTING_LABELS, shortId } from "./serverOpsView";

const t = translator("en");
const entry = (action: string, extra: Partial<ServerActivityEntry> = {}): ServerActivityEntry => ({
  id: "1", at: 0, actor: "owner", action, target: "ana", projectId: null, details: {}, ...extra,
});

describe("the server activity log in words", () => {
  it("says what was done to whom", () => {
    expect(activitySentence(t, entry("account.disabled"), "en")).toBe("owner disabled ana");
    expect(activitySentence(t, entry("account.created", { details: { mailed: true } }), "en")).toBe("owner made the account ana and mailed its link");
    expect(activitySentence(t, entry("account.deleted", { details: { projectsDeleted: 2 } }), "en")).toBe("owner deleted the account ana and 2 projects only it was in");
    expect(activitySentence(t, entry("accounts.exported", { target: null, details: { accounts: 1200 } }), "en")).toBe("owner downloaded the list of 1,200 accounts");
    expect(activitySentence(t, entry("project.coordinator", { projectId: "3f2a9c1b-0000-4000-8000-000000000000" }), "en")).toBe("owner made ana a coordinator of project 3f2a9c1b…");
    expect(activitySentence(t, entry("mail.test", { details: { sent: false, responseCode: 550 } }), "en")).toBe("owner sent a test email, refused by the mail server (550)");
    expect(activitySentence(t, entry("account.signed_out", { actor: null }), "en")).toBe("An administrator signed ana out everywhere");
    expect(activitySentence(t, entry("something.new"), "en")).toBe("owner: something.new");
    expect(activitySentence(t, entry("message.sent", { target: null, details: { audience: "coordinators", recipients: 12, subject: "Maintenance" } }), "en")).toBe("owner sent the message “Maintenance” to 12 people");
    expect(activitySentence(t, entry("message.sent", { target: null, details: { audience: "everyone", recipients: 12, sent: 10, failed: 2, subject: "Maintenance" } }), "en")).toBe("owner sent the message “Maintenance” to 10 people");
    expect(activitySentence(t, entry("alerts.seen", { target: null, details: { count: 3 } }), "en")).toBe("owner marked 3 alerts as seen");
    expect(activitySentence(t, entry("account.unlocked"), "en")).toBe("owner unlocked ana");
  });

  it("names the settings changed by their labels", () => {
    const e = entry("settings.changed", { target: null, details: { signupOpen: true, maxProjectsPerUser: 5, serverName: "changed", contactEmail: null } });
    expect(activitySentence(t, e, "en")).toBe("owner changed Anyone can create an account: on; Most projects one person can coordinate: 5; Server name; Contact email: cleared");
  });

  it("has every setting's label and every sentence in every language", () => {
    for (const key of Object.values(SETTING_LABELS)) expect(CATALOGUES.en[key]).toBeTruthy();
    for (const language of Object.keys(CATALOGUES)) {
      const text = activitySentence(translator(language), entry("project.archived", { projectId: "abc" }), language);
      expect(text).toContain("owner");
      expect(text).toContain("abc");
    }
  });

  it("shortens long ids only", () => {
    expect(shortId("3f2a9c1b-0000-4000-8000-000000000000")).toBe("3f2a9c1b…");
    expect(shortId("abc")).toBe("abc");
  });
});

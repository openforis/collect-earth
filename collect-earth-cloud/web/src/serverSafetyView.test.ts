import { describe, expect, it } from "vitest";
import { emailInDomains, isWebhookUrl, signupDomainsOf, wholeIn } from "./serverSafetyView";

describe("the safety settings, read as typed", () => {
  it("reads whole numbers in their range", () => {
    expect(wholeIn(" 12 ", 8, 64)).toBe(12);
    expect(wholeIn("7", 8, 64)).toBeNull();
    expect(wholeIn("8.5", 8, 64)).toBeNull();
    expect(wholeIn("", 0, 10)).toBeNull();
    expect(wholeIn("0", 0, 10)).toBe(0);
  });

  it("reads the sign-up domains as the server does", () => {
    expect(signupDomainsOf("FAO.org, @example.org\nfao.org")).toBe("fao.org,example.org");
    expect(signupDomainsOf("   ")).toBeNull();
    expect(signupDomainsOf("not a domain!")).toBeUndefined();
    expect(signupDomainsOf("localhost")).toBeUndefined();
  });

  it("accepts Slack and Teams webhooks only", () => {
    expect(isWebhookUrl("https://hooks.slack.com/services/A/B/C")).toBe(true);
    expect(isWebhookUrl("https://contoso.webhook.office.com/webhookb2/x")).toBe(true);
    expect(isWebhookUrl("http://hooks.slack.com/services/A")).toBe(false);
    expect(isWebhookUrl("https://hooks.slack.com.evil.org/x")).toBe(false);
    expect(isWebhookUrl("nonsense")).toBe(false);
  });

  it("checks an address against the domains", () => {
    expect(emailInDomains("ana@rome.fao.org", ["fao.org"])).toBe(true);
    expect(emailInDomains("ana@gmail.com", ["fao.org"])).toBe(false);
    expect(emailInDomains("ana@gmail.com", null)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { accountsToMake, sinceText } from "./serverAccountsView";

describe("the accounts to make, as typed", () => {
  it("reads one per line, with or without an address, whatever is between them", () => {
    expect(accountsToMake("maria, maria@example.org\n\n joao \nana;ana@x.org\nbeto\tbeto@y.org\ncarla carla@z.org")).toEqual({
      accounts: [
        { username: "maria", email: "maria@example.org" },
        { username: "joao", email: null },
        { username: "ana", email: "ana@x.org" },
        { username: "beto", email: "beto@y.org" },
        { username: "carla", email: "carla@z.org" },
      ],
      problems: [],
    });
  });

  it("names the lines the server would refuse", () => {
    expect(accountsToMake("ok1\nno\nmaria, not-an-address\nMaria\nx@y, a@b.org, more").problems).toEqual([
      { kind: "username", line: 2, value: "no" },
      { kind: "email", line: 3, value: "not-an-address" },
      { kind: "email", line: 5, value: "a@b.org more" },
    ]);
    expect(accountsToMake("maria\nMaria").problems).toEqual([{ kind: "twice", line: 2, value: "Maria" }]);
    expect(accountsToMake(Array.from({ length: 101 }, (_, i) => `user${i}`).join("\n")).problems).toEqual([{ kind: "tooMany", line: 0, value: "100" }]);
  });
});

describe("how long ago", () => {
  const now = Date.UTC(2026, 10, 12, 12);
  it("says it in the language, in the largest unit", () => {
    expect(sinceText(now - 30_000, now, "en")).toBe("this minute");
    expect(sinceText(now - 5 * 60_000, now, "en")).toBe("5 minutes ago");
    expect(sinceText(now - 3 * 3600_000, now, "en")).toBe("3 hours ago");
    expect(sinceText(now - 86400_000, now, "en")).toBe("yesterday");
    expect(sinceText(now - 40 * 86400_000, now, "es")).toBe("el mes pasado");
    expect(sinceText(now - 2 * 365 * 86400_000, now, "fr")).toBe("il y a 2 ans");
  });
});

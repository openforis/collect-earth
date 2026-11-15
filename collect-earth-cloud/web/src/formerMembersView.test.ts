import { describe, expect, it } from "vitest";
import type { FormerMember, Member } from "./api";
import { formerMembersView, giveCandidates, isDefaultName } from "./formerMembersView";

const f = (operator: string, records: number, typed: boolean, anonymized = false): FormerMember => ({ operator, records, typed, anonymized });
const m = (username: string, role: Member["role"], disabled = false): Member => ({ userId: `u-${username}`, username, role, ...(disabled ? { disabled } : {}) });

describe("the names on plots that are nobody in the project", () => {
  it("puts the typed names apart from the people who left, most records first", () => {
    const view = formerMembersView([f("bob", 3, false), f("Marta Lopez", 2, true), f("Luis Garcia", 9, true), f("former-member-1", 4, false, true)]);
    expect(view.typed.map((x) => x.operator)).toEqual(["Luis Garcia", "Marta Lopez"]);
    expect(view.left.map((x) => x.operator)).toEqual(["bob"]);
    expect(view.anonymized.map((x) => x.operator)).toEqual(["former-member-1"]);
  });

  it("offers the person whose username is the typed name first, then the collectors, then the others; never a disabled account", () => {
    const people = [m("zoe", "admin"), m("ana", "operator"), m("marta", "reviewer"), m("carl", "operator", true)];
    expect(giveCandidates(people, "Marta").map((x) => x.username)).toEqual(["marta", "ana", "zoe"]);
    expect(giveCandidates(people, "Marta Lopez").map((x) => x.username)).toEqual(["ana", "marta", "zoe"]);
  });

  it("knows the name older Collect Earth gave when nobody typed one", () => {
    expect(isDefaultName(" Collect Earth User ")).toBe(true);
    expect(isDefaultName("Marta")).toBe(false);
  });
});

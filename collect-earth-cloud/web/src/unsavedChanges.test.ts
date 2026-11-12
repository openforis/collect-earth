import { describe, expect, it } from "vitest";
import { clearUnsaved, setUnsaved, unsavedGroups } from "./unsavedChanges";

describe("changes not saved", () => {
  it("lists the groups holding changes, and forgets them", () => {
    setUnsaved("limits", "Limits", true);
    setUnsaved("about", "About", true);
    setUnsaved("limits", "Limits", true);
    expect(unsavedGroups()).toEqual(["Limits", "About"]);
    setUnsaved("limits", "Limits", false);
    expect(unsavedGroups()).toEqual(["About"]);
    clearUnsaved();
    expect(unsavedGroups()).toEqual([]);
  });
});

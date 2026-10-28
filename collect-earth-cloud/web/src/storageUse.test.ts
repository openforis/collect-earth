import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_SETTINGS } from "./api";
import { translator } from "./i18n";
import { draftOf, parseLimit, readDraft } from "./settingsForm";
import { storageLevel, storagePercent, storageText, storageWarningKey } from "./storageUse";

const MB = 1024 * 1024;

describe("space used by a project", () => {
  it("has levels: no limit, fine, nearly full from 90 %, over above 100 %", () => {
    expect(storageLevel(5 * MB, null)).toBe("noLimit");
    expect(storageLevel(5 * MB, 0)).toBe("noLimit");
    expect(storageLevel(0, 200 * MB)).toBe("ok");
    expect(storageLevel(179 * MB, 200 * MB)).toBe("ok");
    expect(storageLevel(180 * MB, 200 * MB)).toBe("nearlyFull");
    expect(storageLevel(200 * MB, 200 * MB)).toBe("nearlyFull");
    expect(storageLevel(200 * MB + 1, 200 * MB)).toBe("over");
  });

  it("warns only when nearly full or over", () => {
    expect(storageWarningKey("noLimit")).toBeNull();
    expect(storageWarningKey("ok")).toBeNull();
    expect(storageWarningKey("nearlyFull")).toBe("storage.nearlyFull");
    expect(storageWarningKey("over")).toBe("storage.over");
  });

  it("gives a bar value capped at 100", () => {
    expect(storagePercent(50, 200)).toBe(25);
    expect(storagePercent(300, 200)).toBe(100);
    expect(storagePercent(10, null)).toBeNull();
  });

  it("says it in plain words, in each language", () => {
    expect(storageText(12 * MB, 200 * MB, translator("en"), "en")).toBe("Space used: 12 MB of 200 MB");
    expect(storageText(12 * MB, null, translator("en"), "en")).toBe("Space used: 12 MB");
    expect(storageText(1536 * 1024, 200 * MB, translator("es"), "es")).toBe("Espacio usado: 1,5 MB de 200 MB");
    expect(storageText(0, 10 * MB, translator("pt"), "pt")).toBe("Espaço usado: 0 B de 10 MB");
  });
});

describe("server page limits and details", () => {
  it("reads limits: empty is 0, only whole numbers", () => {
    expect(parseLimit("")).toBe(0);
    expect(parseLimit(" 25 ")).toBe(25);
    expect(parseLimit("-1")).toBeNull();
    expect(parseLimit("1.5")).toBeNull();
    expect(parseLimit("ten")).toBeNull();
    expect(parseLimit("1000001")).toBeNull();
  });

  it("turns the boxes into settings, empty text clearing a setting", () => {
    const draft = { ...draftOf(DEFAULT_SERVER_SETTINGS), maxProjectsPerUser: "3", serverName: "  FAO  ", termsUrl: "https://e.org/t" };
    expect(readDraft(draft)).toEqual({
      problems: {},
      changes: { maxProjectsPerUser: 3, maxProjectStorageMb: 0, serverName: "FAO", termsUrl: "https://e.org/t", contactEmail: null },
    });
  });

  it("points at every box that is wrong", () => {
    const { problems } = readDraft({
      maxProjectsPerUser: "x",
      maxProjectStorageMb: "-2",
      serverName: "",
      termsUrl: "javascript:alert(1)",
      contactEmail: "nobody",
    });
    expect(problems).toEqual({
      maxProjectsPerUser: "server.badNumber",
      maxProjectStorageMb: "server.badNumber",
      termsUrl: "server.badUrl",
      contactEmail: "server.badEmail",
    });
  });
});

import { describe, expect, it } from "vitest";
import { ApiError, type AiRunSummary, type QuestionAgreement } from "./api";
import {
  AI_LIMIT_MAX,
  causeMessageKey,
  failureMessageKey,
  findingFigures,
  followUpsOf,
  MAX_QUESTION_CHARS,
  parseLimit,
  plotLinks,
  progressMessageKey,
  questionCounter,
  shouldPollRun,
  startErrorText,
  toolMessageKey,
} from "./aiView";
import { CATALOGUES, translator } from "./i18n";

const t = translator("en");

describe("tool names in words", () => {
  it("says what each tool does", () => {
    expect(t(toolMessageKey("get_survey_outline"))).toBe("Reading the survey…");
    expect(t(toolMessageKey("get_confusions"))).toBe("Looking at mixed-up answers…");
    expect(t(toolMessageKey("get_agreement"))).toBe("Looking at how often the checks agree…");
    expect(t(toolMessageKey("get_people"))).toBe("Looking at the figures of each person…");
    expect(t(toolMessageKey("get_differences"))).toBe("Looking at the plots whose checks differ…");
    expect(t(toolMessageKey("get_plot"))).toBe("Looking at the answers of one plot…");
    expect(t(toolMessageKey("get_guidance_notes"))).toBe("Reading the guidance notes…");
  });

  it("an unknown tool is still plain words, and no tool yet is the start", () => {
    expect(t(toolMessageKey("unknown"))).toBe("Looking at the data…");
    expect(t(progressMessageKey([]))).toBe("Getting started…");
    expect(progressMessageKey(["get_agreement", "get_confusions"])).toBe(toolMessageKey("get_confusions"));
  });
});

describe("failure codes in words", () => {
  const codes = [
    "blocked",
    "invalid_answer",
    "ai_unavailable",
    "ai_timeout",
    "token_budget",
    "server_error",
    "no_finding",
    "bad_action",
    "bad_question",
    "interrupted",
    "off_topic",
  ];

  it("each code has its own sentence in every language", () => {
    const keys = codes.map(failureMessageKey);
    expect(new Set(keys).size).toBe(codes.length);
    for (const language of ["en", "es", "fr", "pt"] as const) {
      for (const key of keys) expect(CATALOGUES[language][key], `${language} ${key}`).toBeTruthy();
    }
  });

  it("off topic is the refusal, and an unknown code a general sentence", () => {
    expect(t(failureMessageKey("off_topic"))).toBe("The assistant only answers questions about this project's data quality.");
    expect(t(failureMessageKey("interrupted"))).toMatch(/stopped before it finished/);
    expect(failureMessageKey("something_new")).toBe(failureMessageKey(null));
    expect(t(failureMessageKey(null))).toBe("The assistant could not finish. Try again later.");
  });

  it("causes in words, other for anything else", () => {
    expect(t(causeMessageKey("unclear_question"))).toBe("Likely cause: the question is unclear");
    expect(t(causeMessageKey("other"))).toBe("Likely cause: something else");
  });
});

describe("why a run did not start", () => {
  // 2026-10-31 00:00 UTC
  const resetsAt = Date.UTC(2026, 9, 31);
  const local = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(resetsAt));

  it("a daily limit says when it resets, in local time", () => {
    const reports = new ApiError(429, "ai_daily_limit", "x", { limit: "reports", resetsAt });
    expect(startErrorText(t, reports, "en")).toBe(`This project has used all its AI reviews for today. You can start another one after ${local}.`);
    const followUps = new ApiError(429, "ai_daily_limit", "x", { limit: "follow_ups", resetsAt });
    expect(startErrorText(t, followUps, "en")).toBe(`This project has used all its follow-ups and questions for today. You can ask again after ${local}.`);
    const month = new ApiError(429, "ai_monthly_limit", "x", { resetsAt });
    expect(startErrorText(t, month, "en")).toBe(`This project has used all the assistant's time for this month. It can be used again after ${local}.`);
  });

  it("a limit of 0 (resetsAt null) is not allowed on this server", () => {
    expect(startErrorText(t, new ApiError(429, "ai_daily_limit", "x", { limit: "reports", resetsAt: null }), "en")).toBe(
      "AI reviews are not allowed on this server. The server owner can change this in Server settings.",
    );
    expect(startErrorText(t, new ApiError(429, "ai_daily_limit", "x", { limit: "follow_ups", resetsAt: null }), "en")).toBe(
      "Follow-ups and questions are not allowed on this server. The server owner can change this in Server settings.",
    );
    expect(startErrorText(t, new ApiError(429, "ai_monthly_limit", "x", { resetsAt: null }), "en")).toBe(
      "The AI assistant is not allowed on this server this month. The server owner can change this in Server settings.",
    );
  });

  it("busy is the assistant's own sentence, other errors are left to the error box", () => {
    expect(startErrorText(t, new ApiError(409, "busy", "x"), "en")).toBe("The assistant is already working for this project. Wait until it has finished.");
    expect(startErrorText(t, new ApiError(409, "ai_not_enabled", "x"), "en")).toBeNull();
    expect(startErrorText(t, new Error("x"), "en")).toBeNull();
  });
});

describe("the panel's helpers", () => {
  it("asks for a run's progress only while it runs and the page is visible", () => {
    expect(shouldPollRun("running", false)).toBe(true);
    expect(shouldPollRun("running", true)).toBe(false);
    expect(shouldPollRun("done", false)).toBe(false);
    expect(shouldPollRun("failed", false)).toBe(false);
  });

  it("links only plots that are in the differences list", () => {
    expect(plotLinks(["21", "99"], new Set(["21"]))).toEqual([
      { plot: "21", linked: true },
      { plot: "99", linked: false },
    ]);
  });

  it("shows the server's figures for a finding's questions, not the model's", () => {
    const questions: QuestionAgreement[] = [{ key: "q1", label: "Land use", kind: "choice", compared: 50, agreeing: 41, rate: 0.82, margin: null }];
    expect(findingFigures(["q1", "q9"], questions)).toEqual([
      { key: "q1", label: "Land use", rate: { compared: 50, agreeing: 41, rate: 0.82 } },
      { key: "q9", label: "q9", rate: null },
    ]);
  });

  it("counts the question's characters up to 300", () => {
    expect(MAX_QUESTION_CHARS).toBe(300);
    expect(questionCounter("abc")).toEqual({ count: 3, over: false, empty: false });
    expect(questionCounter("  ")).toEqual({ count: 2, over: false, empty: true });
    expect(questionCounter("x".repeat(301))).toEqual({ count: 301, over: true, empty: false });
    // Characters, not UTF-16 units, as the server counts.
    expect(questionCounter("🌳🌳").count).toBe(2);
  });

  it("groups a report's follow-ups by finding, and its questions", () => {
    const run = (id: string, kind: AiRunSummary["kind"], parentRunId: string | null, findingIndex: number | null): AiRunSummary => ({
      id,
      kind,
      status: "done",
      startedAt: 0,
      finishedAt: 0,
      startedBy: null,
      tokens: 0,
      parentRunId,
      findingIndex,
      action: kind === "follow_up" ? "explain" : null,
      errorCode: null,
    });
    const runs = [run("f2", "follow_up", "r1", 1), run("q1", "question", "r1", null), run("f1", "follow_up", "r1", 1), run("x", "follow_up", "r0", 1), run("r1", "report", null, null)];
    const { byFinding, questions } = followUpsOf(runs, "r1");
    // Oldest first under each finding (runs come newest first).
    expect(byFinding.get(1)?.map((r) => r.id)).toEqual(["f1", "f2"]);
    expect(questions.map((r) => r.id)).toEqual(["q1"]);
  });

  it("reads a limit: a whole number from 0 to its maximum", () => {
    expect(parseLimit(" 12 ", AI_LIMIT_MAX.aiReportsPerDay)).toBe(12);
    expect(parseLimit("0", AI_LIMIT_MAX.aiReportsPerDay)).toBe(0);
    expect(parseLimit("2 000 000", AI_LIMIT_MAX.aiMonthlyTokens)).toBe(2_000_000);
    expect(parseLimit("2,000,000", AI_LIMIT_MAX.aiMonthlyTokens)).toBe(2_000_000);
    for (const bad of ["", "-1", "2.5", "abc", "1001"]) expect(parseLimit(bad, AI_LIMIT_MAX.aiReportsPerDay), bad).toBeNull();
  });
});

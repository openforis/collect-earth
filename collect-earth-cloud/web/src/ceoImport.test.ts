import { describe, expect, it } from "vitest";
import { ceoAnswersUrl, ceoFileKind, ceoProjectIdOf } from "./pages/CeoImportDialog";

describe("CEO's files, told apart by their shape", () => {
  it("the project is an object, the plot list an array, the sample data a CSV (with its UTF-8 mark)", () => {
    expect(ceoFileKind('{"id": 1, "surveyQuestions": {}}')).toBe("project");
    expect(ceoFileKind(' [{"center": "..."}]')).toBe("plots");
    expect(ceoFileKind("﻿plotid,sampleid,sample_internal_id")).toBe("answers");
    expect(ceoFileKind("plotid,sampleid")).toBe("answers");
  });

  it("links to CEO's download of the answers", () => {
    expect(ceoAnswersUrl("2616")).toBe("https://app.collect.earth/dump-project-raw-data?projectId=2616");
  });

  it("finds the project number in a pasted CEO address, or takes it typed", () => {
    expect(ceoProjectIdOf(" 2616 ")).toBe("2616");
    expect(ceoProjectIdOf("https://app.collect.earth/collection?projectId=2616")).toBe("2616");
    expect(ceoProjectIdOf("https://app.collect.earth/review-project?projectId=743&plotId=5")).toBe("743");
    expect(ceoProjectIdOf("app.collect.earth/project-dashboard?institutionId=3&projectId=1")).toBe("1");
    expect(ceoProjectIdOf("https://app.collect.earth/collection?plotId=12")).toBeNull();
    expect(ceoProjectIdOf("12ab")).toBeNull();
    expect(ceoProjectIdOf("")).toBeNull();
  });
});

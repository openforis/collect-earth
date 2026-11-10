import { describe, expect, it } from "vitest";
import { ceoAnswersUrl, ceoFileKind } from "./pages/CeoImportDialog";

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
});

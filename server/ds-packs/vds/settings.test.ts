import { describe, expect, test } from "vitest";
import { readPackSettings } from "./settings";

describe("VDS pack settings", () => {
  const settings = readPackSettings();

  test("the system prompt sent to the model has no placeholder comment", () => {
    expect(settings.systemPrompt).not.toContain("<!--");
    expect(settings.systemPrompt).not.toContain("PLACEHOLDER");
    expect(settings.systemPrompt.startsWith("You edit VDS experiences")).toBe(true);
  });

  test("the pack names its guideline collection and composition types", () => {
    expect(settings.guidelineCollection).toBe("vds-guidelines");
    expect(settings.compositionTypes).toEqual(["plan-tile", "summary-tile"]);
  });
});

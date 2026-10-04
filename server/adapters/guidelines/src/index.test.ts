import { describe, expect, test } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileGuidelineSource } from "./index";

const file = join(mkdtempSync(join(tmpdir(), "guidelines-")), "guidelines.json");
writeFileSync(
  file,
  JSON.stringify({
    entries: [
      { sourceId: "bg", component: "TileContainer", topic: "background", text: "Use surface tokens." },
      { sourceId: "tile-any", component: "TileContainer", text: "Whole-component note." },
      { sourceId: "badge-color", component: "Badge", topic: "backgroundColor", text: "Approved tokens only." },
    ],
  }),
);

describe("file guideline source (stub for the RAG endpoint)", () => {
  const source = createFileGuidelineSource(file);

  test("returns the passages for the components asked about, with source ids", async () => {
    expect(await source.search({ query: "any question", components: ["TileContainer"] })).toEqual([
      { sourceId: "bg", text: "Use surface tokens." },
      { sourceId: "tile-any", text: "Whole-component note." },
    ]);
  });

  test("returns passages for every component when none is named", async () => {
    expect(await source.search({ query: "any question", components: [] })).toHaveLength(3);
  });

  test("returns nothing for a component with no guidelines", async () => {
    expect(await source.search({ query: "any question", components: ["Divider"] })).toEqual([]);
  });

  test("rejects a file whose shape is wrong", () => {
    const bad = join(mkdtempSync(join(tmpdir(), "guidelines-bad-")), "g.json");
    writeFileSync(bad, JSON.stringify({ entries: [{ component: "Badge" }] }));
    expect(() => createFileGuidelineSource(bad)).toThrow();
  });
});

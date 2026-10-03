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

  test("returns passages for the component and topic, with source ids", async () => {
    expect(await source.search({ component: "TileContainer", topic: "background" })).toEqual([
      { sourceId: "bg", text: "Use surface tokens." },
      { sourceId: "tile-any", text: "Whole-component note." },
    ]);
  });

  test("a topic that matches nothing returns only the component-wide notes", async () => {
    expect(await source.search({ component: "TileContainer", topic: "padding" })).toEqual([
      { sourceId: "tile-any", text: "Whole-component note." },
    ]);
  });

  test("returns nothing for a component with no guidelines", async () => {
    expect(await source.search({ component: "Divider" })).toEqual([]);
  });

  test("rejects a file whose shape is wrong", () => {
    const bad = join(mkdtempSync(join(tmpdir(), "guidelines-bad-")), "g.json");
    writeFileSync(bad, JSON.stringify({ entries: [{ component: "Badge" }] }));
    expect(() => createFileGuidelineSource(bad)).toThrow();
  });
});

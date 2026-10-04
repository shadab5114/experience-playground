import { describe, expect, test } from "vitest";
import type { A2UIDocument } from "@experience-agent/contract";
import { documentComponents, documentSlots } from "./document";

const doc = (components: Record<string, unknown>[][]): A2UIDocument =>
  ({
    a2ui: [
      { version: "v0.9", createSurface: { surfaceId: "main", catalogId: "x" } },
      ...components.map((batch) => ({
        version: "v0.9",
        updateComponents: { surfaceId: "main", components: batch },
      })),
    ],
  }) as unknown as A2UIDocument;

describe("documentComponents", () => {
  test("names every component across all updateComponents messages, without duplicates", () => {
    const d = doc([
      [
        { id: "root", component: "TileContainer", children: ["content"] },
        { id: "content", component: "Stack", children: ["title"] },
      ],
      [{ id: "title", component: "Text" }, { id: "other", component: "Text" }],
    ]);
    expect(documentComponents(d)).toEqual(["TileContainer", "Stack", "Text"]);
  });

  test("a document with no components has none", () => {
    expect(documentComponents(doc([]))).toEqual([]);
  });
});

describe("documentSlots", () => {
  test("reads slot ids from Slot nodes, in document order and deduplicated", () => {
    const d = doc([
      [
        { id: "root", component: "Stack", children: ["plan", "promo", "plan-again"] },
        { id: "promo", component: "Slot", slotId: "promo-rail" },
        { id: "plan", component: "Slot", slotId: "plan-summary" },
        { id: "plan-again", component: "Slot", slotId: "promo-rail" },
      ],
    ]);
    expect(documentSlots(d)).toEqual(["promo-rail", "plan-summary"]);
  });

  test("a composition declares no slots", () => {
    expect(documentSlots(doc([[{ id: "root", component: "TileContainer" }]]))).toEqual([]);
  });

  test("a Slot without a string slotId is ignored rather than crashing", () => {
    const d = doc([[{ id: "broken", component: "Slot" }, { id: "alsoBroken", component: "Slot", slotId: 7 }]]);
    expect(documentSlots(d)).toEqual([]);
  });
});

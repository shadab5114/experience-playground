import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import {
  CompositionRecord,
  PageTemplateRecord,
  PlacementRecord,
  type A2UIDocument,
  type CompositionInput,
  type PageTemplateInput,
} from "@experience-agent/contract";
import { PostgresAuthoringStore } from "./authoring";
import { resetTestDatabase } from "./testing";

let pool: pg.Pool;
let store: PostgresAuthoringStore;

// The pack's a2uiVersion, which authored records inherit rather than being asked for.
const A2UI_VERSION = "v0.9";

function docWith(components: Record<string, unknown>[], declaredComponents: string[] = []): A2UIDocument {
  return {
    meta: {
      provider: "studio",
      model: "none",
      catalogId: "https://pdesign.dev/catalog/v1/catalog.json",
      components: declaredComponents,
      generatedAt: "2026-10-04T00:00:00.000Z",
    },
    a2ui: [
      { version: "v0.9", createSurface: { surfaceId: "main", catalogId: "https://pdesign.dev/catalog/v1/catalog.json" } },
      { version: "v0.9", updateDataModel: { surfaceId: "main", path: "/", value: {} } },
      { version: "v0.9", updateComponents: { surfaceId: "main", components } },
    ],
  } as unknown as A2UIDocument;
}

const tileInput = (over: Partial<CompositionInput> = {}): CompositionInput => ({
  compositionId: "studio-tile",
  name: "Studio Tile",
  family: "Studio Tile",
  description: "A tile authored in the Studio.",
  type: "plan-tile",
  tags: ["studio"],
  a2ui: docWith([
    { id: "root", component: "TileContainer", children: ["content"] },
    { id: "content", component: "Stack", direction: "column", children: ["title"] },
    { id: "title", component: "Text", children: "Hello" },
  ]),
  ...over,
});

const pageInput = (over: Partial<PageTemplateInput> = {}): PageTemplateInput => ({
  pageTemplateId: "studio-page",
  name: "Studio Page",
  a2ui: docWith([
    { id: "root", component: "Stack", direction: "column", children: ["plan", "promo"] },
    { id: "plan", component: "Slot", slotId: "plan-summary" },
    { id: "promo", component: "Slot", slotId: "promo-rail" },
  ]),
  ...over,
});

beforeAll(async () => {
  pool = await resetTestDatabase();
  store = new PostgresAuthoringStore(pool, "vds", A2UI_VERSION);
});

afterAll(async () => {
  await pool.end();
});

describe("compositions", () => {
  test("listCompositions returns full records for the imported samples", async () => {
    const list = await store.listCompositions();
    expect(list.map((c) => c.compositionId)).toEqual(["basic-plan-tile", "home-plan-tile", "order-summary-tile"]);

    const basic = list.find((c) => c.compositionId === "basic-plan-tile")!;
    // Every record is exactly what the contract says it is, or the UI can't trust it.
    expect(CompositionRecord.parse(basic)).toEqual(basic);
    expect(basic.origin).toBe("sample");
    expect(basic.componentsUsed).toEqual(["TileContainer", "Stack", "Badge", "Text"]);
    expect(basic.family).toBe("Basic Plan Tile");
    // Nothing has written rules yet, so the field is absent rather than null.
    expect("agentRules" in basic).toBe(false);
  });

  test("upsertComposition inserts an authored record and derives components_used", async () => {
    // meta.components lies on purpose: the store must read the document, not the header.
    const input = tileInput({ a2ui: docWith(
      [
        { id: "root", component: "TileContainer", children: ["content"] },
        { id: "content", component: "Stack", children: ["badge"] },
        { id: "badge", component: "Badge", children: "New" },
      ],
      ["Nonsense", "AlsoWrong"],
    ) });

    const record = await store.upsertComposition(input);

    expect(CompositionRecord.parse(record)).toEqual(record);
    expect(record.componentsUsed).toEqual(["TileContainer", "Stack", "Badge"]);
    expect(record.origin).toBe("authored");
    expect(record.a2uiVersion).toBe(A2UI_VERSION);
    expect(record.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await store.listCompositions()).map((c) => c.compositionId)).toContain("studio-tile");
  });

  test("upsertComposition stores agent rules and gives them back", async () => {
    const record = await store.upsertComposition(
      tileInput({ agentRules: "Never change the price text. Badge may only be red or neonYellow." }),
    );
    expect(record.agentRules).toBe("Never change the price text. Badge may only be red or neonYellow.");
  });

  test("editing a sample composition keeps origin 'sample' and moves updated_at", async () => {
    const before = (await store.listCompositions()).find((c) => c.compositionId === "home-plan-tile")!;

    const edited = await store.upsertComposition({
      compositionId: "home-plan-tile",
      name: "Home Plan (edited)",
      family: before.family,
      description: before.description,
      agentRules: "Keep the eyebrow short.",
      type: before.type,
      tags: [...before.tags, "edited"],
      a2ui: before.a2ui,
    });

    // origin records where a row came from, not whether anyone has touched it.
    expect(edited.origin).toBe("sample");
    expect(edited.name).toBe("Home Plan (edited)");
    expect(edited.agentRules).toBe("Keep the eyebrow short.");
    expect(Date.parse(edited.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt));
  });

  test("compositionDeleteImpact names what a hard delete takes with it", async () => {
    await store.appendVersion({ compositionId: "basic-plan-tile", a2ui: tileInput().a2ui, savedBy: "agent" });
    await store.appendVersion({ compositionId: "basic-plan-tile", a2ui: tileInput().a2ui, savedBy: "studio" });

    expect(await store.compositionDeleteImpact("basic-plan-tile")).toEqual({
      origin: "sample",
      placements: 3,
      savedVersions: 2,
    });
    // An authored tile with nothing pointing at it: the dialog says it is gone for good.
    expect(await store.compositionDeleteImpact("studio-tile")).toEqual({
      origin: "authored",
      placements: 0,
      savedVersions: 0,
    });
    expect(await store.compositionDeleteImpact("no-such-tile")).toBeNull();
  });

  test("deleteComposition reports whether it deleted anything", async () => {
    expect(await store.deleteComposition("no-such-tile")).toBe(false);
    expect(await store.deleteComposition("studio-tile")).toBe(true);
    expect((await store.listCompositions()).map((c) => c.compositionId)).not.toContain("studio-tile");
  });
});

describe("page templates", () => {
  test("upsertPageTemplate derives slots from the document's Slot nodes", async () => {
    const record = await store.upsertPageTemplate(pageInput({ description: "A page authored in the Studio." }));

    expect(PageTemplateRecord.parse(record)).toEqual(record);
    expect(record.slots).toEqual(["plan-summary", "promo-rail"]);
    expect(record.origin).toBe("authored");
    expect(record.description).toBe("A page authored in the Studio.");
  });

  test("removing a Slot node removes the slot; nobody can declare one by hand", async () => {
    const record = await store.upsertPageTemplate(
      pageInput({
        a2ui: docWith([
          { id: "root", component: "Stack", children: ["plan"] },
          { id: "plan", component: "Slot", slotId: "plan-summary" },
        ]),
      }),
    );
    expect(record.slots).toEqual(["plan-summary"]);
  });

  test("listPageTemplates includes samples and authored pages, with sample pages still marked", async () => {
    const list = await store.listPageTemplates();
    const byId = new Map(list.map((p) => [p.pageTemplateId, p]));
    expect(byId.get("pdp-mock")?.origin).toBe("sample");
    expect(byId.get("pdp-mock")?.slots).toEqual(["plan-summary"]);
    expect(byId.get("studio-page")?.origin).toBe("authored");
  });

  test("pageTemplateDeleteImpact counts placements and never version history", async () => {
    expect(await store.pageTemplateDeleteImpact("pdp-mock")).toEqual({
      origin: "sample",
      placements: 1,
      savedVersions: 0,
    });
    expect(await store.pageTemplateDeleteImpact("no-such-page")).toBeNull();
  });
});

describe("placements", () => {
  test("setPlacement creates a mapping, then updates its variant and position in place", async () => {
    await store.setPlacement({
      compositionId: "home-plan-tile",
      pageTemplateId: "studio-page",
      slotId: "plan-summary",
      position: 0,
    });
    const created = await store.placementsForPage("studio-page");
    expect(created.map((p) => PlacementRecord.parse(p))).toEqual(created);
    expect(created).toEqual([
      {
        compositionId: "home-plan-tile",
        pageTemplateId: "studio-page",
        slotId: "plan-summary",
        position: 0,
      },
    ]);

    await store.setPlacement({
      compositionId: "home-plan-tile",
      pageTemplateId: "studio-page",
      slotId: "plan-summary",
      variant: "compact",
      position: 2,
    });
    expect(await store.placementsForPage("studio-page")).toEqual([
      {
        compositionId: "home-plan-tile",
        pageTemplateId: "studio-page",
        slotId: "plan-summary",
        variant: "compact",
        position: 2,
      },
    ]);
  });

  test("placementsForPage comes back in position order", async () => {
    await store.setPlacement({
      compositionId: "order-summary-tile",
      pageTemplateId: "studio-page",
      slotId: "promo-rail",
      position: 1,
    });
    expect((await store.placementsForPage("studio-page")).map((p) => p.slotId)).toEqual([
      "promo-rail",
      "plan-summary",
    ]);
  });

  test("deletePlacement removes exactly one mapping", async () => {
    await store.deletePlacement({
      compositionId: "order-summary-tile",
      pageTemplateId: "studio-page",
      slotId: "promo-rail",
    });
    expect((await store.placementsForPage("studio-page")).map((p) => p.slotId)).toEqual(["plan-summary"]);
  });

  test("deleting a page template takes its placements with it", async () => {
    expect(await store.deletePageTemplate("studio-page")).toBe(true);
    expect(await store.placementsForPage("studio-page")).toEqual([]);
    expect(await store.deletePageTemplate("studio-page")).toBe(false);
  });
});

describe("version history", () => {
  test("versions number from 1 and come back newest first, with who saved each", async () => {
    const first = await store.appendVersion({
      compositionId: "order-summary-tile",
      a2ui: tileInput().a2ui,
      summary: "Pasted the first draft",
      savedBy: "studio",
    });
    const second = await store.appendVersion({
      compositionId: "order-summary-tile",
      a2ui: tileInput().a2ui,
      summary: "Made the badge smaller",
      savedBy: "agent",
    });
    expect([first, second]).toEqual([1, 2]);

    const history = await store.listVersions("order-summary-tile");
    expect(history.map((v) => [v.version, v.savedBy, v.summary])).toEqual([
      [2, "agent", "Made the badge smaller"],
      [1, "studio", "Pasted the first draft"],
    ]);
    expect(history[0]?.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("a version needs no summary", async () => {
    const version = await store.appendVersion({
      compositionId: "order-summary-tile",
      a2ui: tileInput().a2ui,
      savedBy: "studio",
    });
    const latest = (await store.listVersions("order-summary-tile"))[0]!;
    expect(latest.version).toBe(version);
    expect("summary" in latest).toBe(false);
  });

  test("appendVersion refuses a composition that does not exist", async () => {
    await expect(
      store.appendVersion({ compositionId: "no-such-tile", a2ui: tileInput().a2ui, savedBy: "studio" }),
    ).rejects.toThrow(/no-such-tile/);
  });

  test("deleting a composition takes its history with it", async () => {
    expect(await store.deleteComposition("order-summary-tile")).toBe(true);
    expect(await store.listVersions("order-summary-tile")).toEqual([]);
  });
});

describe("pack scoping", () => {
  test("a store for another pack sees none of this pack's content", async () => {
    const other = new PostgresAuthoringStore(pool, "other-pack", A2UI_VERSION);
    expect(await other.listCompositions()).toEqual([]);
    expect(await other.listPageTemplates()).toEqual([]);
    expect(await other.compositionDeleteImpact("basic-plan-tile")).toBeNull();
    expect(await other.deleteComposition("basic-plan-tile")).toBe(false);
  });
});

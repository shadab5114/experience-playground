import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { PostgresCompositionStore } from "./store";
import { importSamples } from "./samples";
import { resetTestDatabase, VDS_PACK_DIR } from "./testing";

let pool: pg.Pool;
let store: PostgresCompositionStore;

beforeAll(async () => {
  pool = await resetTestDatabase();
  store = new PostgresCompositionStore(pool, "vds");
});

afterAll(async () => {
  await pool.end();
});

describe("PostgresCompositionStore", () => {
  test("list returns every seeded composition, ordered by name", async () => {
    const list = await store.list();
    expect(list.map((c) => c.compositionId).sort()).toEqual([
      "basic-plan-tile",
      "home-plan-tile",
      "order-summary-tile",
    ]);
    const names = list.map((c) => c.name);
    expect(names).toEqual([...names].sort());
  });

  test("list filters by type", async () => {
    const plans = await store.list({ type: "plan-tile" });
    expect(plans.map((c) => c.compositionId).sort()).toEqual(["basic-plan-tile", "home-plan-tile"]);
  });

  test("list searches by name, case-insensitively, and treats % literally", async () => {
    expect((await store.list({ q: "basic" })).map((c) => c.compositionId)).toEqual(["basic-plan-tile"]);
    expect(await store.list({ q: "100%" })).toEqual([]);
  });

  test("get returns the composition's A2UI document", async () => {
    const detail = await store.get("basic-plan-tile");
    expect(detail?.a2ui.a2ui[0]).toMatchObject({ version: "v0.9" });
    expect(detail?.a2ui.meta?.components).toContain("TileContainer");
  });

  test("types lists the composition types in use, deduplicated and sorted", async () => {
    // Read from the data, not from pack.json: a type authored in the Studio
    // has to reach the agent's prompt too.
    expect(await store.types()).toEqual(["plan-tile", "summary-tile"]);
  });

  test("types is scoped to the pack", async () => {
    expect(await new PostgresCompositionStore(pool, "other-pack").types()).toEqual([]);
  });

  test("get returns null for an unknown id", async () => {
    expect(await store.get("nope")).toBeNull();
  });

  test("placements come back in tab order with page A2UI attached", async () => {
    const placements = await store.placements("basic-plan-tile");
    expect(placements.map((p) => p.pageName)).toEqual(["PDP", "AAL", "Order Summary"]);
    expect(placements.every((p) => p.slotId === "plan-summary")).toBe(true);
    expect(placements[2]?.variant).toBe("compact");
    expect(placements[0]?.variant).toBeUndefined();
    expect(placements[0]?.pageA2ui.a2ui.length).toBeGreaterThan(0);
  });
});

describe("importSamples", () => {
  test("running the import twice changes nothing", async () => {
    const before = await pool.query<{ id: string; updated_at: Date }>(
      "select id, updated_at from compositions order by id",
    );
    const placementsBefore = await pool.query("select count(*)::int as n from placements");

    const counts = await importSamples(pool, VDS_PACK_DIR);

    const after = await pool.query<{ id: string; updated_at: Date }>(
      "select id, updated_at from compositions order by id",
    );
    const placementsAfter = await pool.query("select count(*)::int as n from placements");

    expect(counts).toEqual({ compositions: 0, pageTemplates: 0, placements: 0 });
    expect(after.rows).toEqual(before.rows);
    expect(placementsAfter.rows).toEqual(placementsBefore.rows);
  });

  test("imported rows are marked as samples and carry derived components_used", async () => {
    const { rows } = await pool.query<{ origin: string; components_used: string[] }>(
      "select origin, components_used from compositions where id = $1",
      ["basic-plan-tile"],
    );
    expect(rows[0]?.origin).toBe("sample");
    expect(rows[0]?.components_used).toEqual(["TileContainer", "Stack", "Badge", "Text"]);
  });

  test("authored edits to a sample row survive a re-import", async () => {
    await pool.query("update compositions set name = $1, agent_rules = $2, origin = $3 where id = $4", [
      "Authored name",
      "Never change the price text.",
      "authored",
      "home-plan-tile",
    ]);

    await importSamples(pool, VDS_PACK_DIR);

    const { rows } = await pool.query<{ name: string; agent_rules: string | null; origin: string }>(
      "select name, agent_rules, origin from compositions where id = $1",
      ["home-plan-tile"],
    );
    expect(rows[0]).toEqual({
      name: "Authored name",
      agent_rules: "Never change the price text.",
      origin: "authored",
    });
  });

  test("a re-import leaves authored rows alone and restores a deleted sample row", async () => {
    await pool.query(
      `insert into compositions (id, ds_pack, name, family, description, type, tags, a2ui_version, a2ui)
       values ($1, 'vds', 'Studio tile', 'Studio', 'authored in the UI', 'plan-tile', '{}', 'v0.9', $2::jsonb)`,
      ["studio-tile", JSON.stringify({ meta: {}, a2ui: [] })],
    );
    // Deleting a sample row is undone by an explicit re-import — that is what the
    // "Re-import samples" action is for. Only rows the samples do not describe,
    // such as the authored one above, are the importer's business to leave alone.
    await pool.query("delete from placements where composition_id = $1 and page_template_id = $2", [
      "basic-plan-tile",
      "aal-mock",
    ]);

    const counts = await importSamples(pool, VDS_PACK_DIR);

    expect(counts).toEqual({ compositions: 0, pageTemplates: 0, placements: 1 });
    const authored = await pool.query<{ name: string; origin: string }>(
      "select name, origin from compositions where id = $1",
      ["studio-tile"],
    );
    expect(authored.rows[0]).toEqual({ name: "Studio tile", origin: "authored" });
    const restored = await pool.query<{ page_template_id: string }>(
      "select page_template_id from placements where composition_id = $1 order by position",
      ["basic-plan-tile"],
    );
    expect(restored.rows.map((r) => r.page_template_id)).toEqual(["pdp-mock", "aal-mock", "order-summary-mock"]);
  });

  test("deleting a composition cascades to its placements and history", async () => {
    await pool.query(
      "insert into composition_versions (composition_id, version, a2ui, saved_by) values ($1, 1, $2::jsonb, $3)",
      ["basic-plan-tile", JSON.stringify({ meta: {}, a2ui: [] }), "studio"],
    );
    await pool.query("delete from compositions where id = $1", ["basic-plan-tile"]);

    const placements = await pool.query<{ n: number }>(
      "select count(*)::int as n from placements where composition_id = $1",
      ["basic-plan-tile"],
    );
    const versions = await pool.query<{ n: number }>(
      "select count(*)::int as n from composition_versions where composition_id = $1",
      ["basic-plan-tile"],
    );
    expect([placements.rows[0]?.n, versions.rows[0]?.n]).toEqual([0, 0]);
  });

  test("deleting a page template cascades to its placements", async () => {
    await pool.query("delete from page_templates where id = $1", ["pdp-mock"]);
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from placements where page_template_id = $1",
      ["pdp-mock"],
    );
    expect(rows[0]?.n).toBe(0);
  });
});

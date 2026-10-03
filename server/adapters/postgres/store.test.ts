import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { PostgresCompositionStore } from "./store";
import { seedPack } from "./seed";
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

  test("get returns null for an unknown id", async () => {
    expect(await store.get("nope")).toBeNull();
  });

  test("placements come back in tab order with page A2UI attached", async () => {
    const placements = await store.placements("basic-plan-tile");
    expect(placements.map((p) => p.flowName)).toEqual(["PDP", "AAL", "Order Summary"]);
    expect(placements.every((p) => p.slotId === "plan-summary")).toBe(true);
    expect(placements[2]?.variant).toBe("compact");
    expect(placements[0]?.variant).toBeUndefined();
    expect(placements[0]?.pageA2ui.a2ui.length).toBeGreaterThan(0);
  });
});

describe("seedPack", () => {
  test("running the seed twice changes nothing", async () => {
    const before = await pool.query<{ id: string; updated_at: Date }>(
      "select id, updated_at from compositions order by id",
    );
    const placementsBefore = await pool.query("select count(*)::int as n from placements");

    await seedPack(pool, VDS_PACK_DIR);

    const after = await pool.query<{ id: string; updated_at: Date }>(
      "select id, updated_at from compositions order by id",
    );
    const placementsAfter = await pool.query("select count(*)::int as n from placements");

    expect(after.rows).toEqual(before.rows);
    expect(placementsAfter.rows).toEqual(placementsBefore.rows);
  });
});

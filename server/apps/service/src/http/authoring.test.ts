import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import type {
  CompositionRecord,
  CompositionVersionSummary,
  DeleteImpact,
  FlowRecord,
  PageTemplateRecord,
  PlacementRecord,
  ValidationReport,
} from "@experience-agent/contract";
import { importSamples, PostgresAuthoringStore, PostgresCompositionStore } from "@experience-agent/postgres";
import { createVdsCatalog, readPackSettings } from "@experience-agent/vds-pack";
import { createRecordingLog } from "../../../../adapters/langgraph/src/testing";
import { resetTestDatabase, VDS_PACK_DIR } from "../../../../adapters/postgres/testing";
import type { AgentEngine } from "@experience-agent/core";
import { createApp } from "./app";
import { withListCache } from "../cache";

const CATALOG_ID = "https://pdesign.dev/catalog/v1/catalog.json";

// A long cache TTL on purpose: it is what makes a missing invalidate() visible.
const LIST_TTL_MS = 60_000;

const unusedEngine: AgentEngine = {
  run() {
    throw new Error("the engine should not run in this test");
  },
};

let pool: pg.Pool;
let app: ReturnType<typeof createApp>;
// An app with no authoring deps, to prove the write door is opt-in.
let readOnlyApp: ReturnType<typeof createApp>;

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const request = async (path: string, method: string, body?: unknown): Promise<Response> =>
  app.request(`/v1/authoring${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

function doc(components: Record<string, unknown>[]): unknown {
  return {
    meta: { provider: "studio", model: "none", catalogId: CATALOG_ID, components: [], generatedAt: "2026-10-04T00:00:00.000Z" },
    a2ui: [
      { version: "v0.9", createSurface: { surfaceId: "main", catalogId: CATALOG_ID } },
      { version: "v0.9", updateDataModel: { surfaceId: "main", path: "/", value: { plan: { name: "Studio Plan" } } } },
      { version: "v0.9", updateComponents: { surfaceId: "main", components } },
    ],
  };
}

const tileDoc = doc([
  { id: "root", component: "TileContainer", children: ["content"] },
  { id: "content", component: "Stack", direction: "column", children: ["title"] },
  { id: "title", component: "Text", children: { path: "/plan/name" } },
]);

const pageDoc = doc([
  { id: "root", component: "Stack", direction: "column", children: ["plan"] },
  { id: "plan", component: "Slot", slotId: "plan-summary" },
]);

const tileBody = (over: Record<string, unknown> = {}) => ({
  compositionId: "studio-tile",
  name: "Studio Tile",
  family: "Studio Tile",
  description: "A tile authored in the Studio.",
  type: "plan-tile",
  tags: ["studio"],
  a2ui: tileDoc,
  ...over,
});

beforeAll(async () => {
  pool = await resetTestDatabase();
  const settings = readPackSettings();
  const compositions = withListCache(new PostgresCompositionStore(pool, "vds"), LIST_TTL_MS);
  const deps = {
    compositions,
    pingDatabase: () => pool.query("select 1").then(() => undefined),
    engine: unusedEngine,
    threadLock: { tryAcquire: async () => null },
    log: createRecordingLog(),
  };
  app = createApp({
    ...deps,
    authoring: {
      authoring: new PostgresAuthoringStore(pool, "vds", settings.a2uiVersion),
      catalog: createVdsCatalog(),
      importSamples: () => importSamples(pool, VDS_PACK_DIR),
    },
  });
  readOnlyApp = createApp(deps);
});

afterAll(async () => {
  await pool.end();
});

describe("the write door is opt-in", () => {
  test("without authoring deps the routes are not mounted", async () => {
    expect((await readOnlyApp.request("/v1/authoring/compositions")).status).toBe(404);
  });

  test("CORS preflight allows PUT, which the authoring routes need", async () => {
    const res = await app.request("/v1/authoring/compositions/studio-tile", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "PUT" },
    });
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
  });
});

describe("GET /v1/authoring/compositions", () => {
  test("returns full records, not the picker's summaries", async () => {
    const res = await request("/compositions", "GET");
    expect(res.status).toBe(200);
    const records = await json<CompositionRecord[]>(res);
    const basic = records.find((r) => r.compositionId === "basic-plan-tile")!;
    expect(basic.family).toBe("Basic Plan Tile");
    expect(basic.origin).toBe("sample");
    expect(basic.componentsUsed).toContain("TileContainer");
  });
});

describe("PUT /v1/authoring/compositions/:id", () => {
  test("creates an authored record, appends version 1, and clears the picker cache", async () => {
    // Prime the cached list first: without invalidation the new tile stays
    // invisible for LIST_TTL_MS, which reads as a lost save.
    const before = await json<{ compositionId: string }[]>(await app.request("/v1/compositions"));
    expect(before.map((c) => c.compositionId)).not.toContain("studio-tile");

    const res = await request("/compositions/studio-tile", "PUT", tileBody({ summary: "Pasted the first draft" }));
    expect(res.status).toBe(200);
    const saved = await json<{ record: CompositionRecord; version: number; warnings: unknown[] }>(res);
    expect(saved.version).toBe(1);
    expect(saved.record.origin).toBe("authored");
    expect(saved.record.componentsUsed).toEqual(["TileContainer", "Stack", "Text"]);

    const after = await json<{ compositionId: string }[]>(await app.request("/v1/compositions"));
    expect(after.map((c) => c.compositionId)).toContain("studio-tile");
  });

  test("a second save appends version 2", async () => {
    const res = await request("/compositions/studio-tile", "PUT", tileBody({ name: "Studio Tile v2" }));
    expect((await json<{ version: number }>(res)).version).toBe(2);
  });

  test("rejects a body that does not match the contract", async () => {
    const res = await request("/compositions/studio-tile", "PUT", tileBody({ description: "" }));
    expect(res.status).toBe(400);
    expect(await json<{ error: string; issues: unknown[] }>(res)).toMatchObject({ error: "Invalid composition" });
  });

  test("rejects a body whose id disagrees with the path", async () => {
    const res = await request("/compositions/studio-tile", "PUT", tileBody({ compositionId: "other-tile" }));
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/does not match the path id/);
  });

  test("refuses to store a document that breaks a DS rule, with the code the agent gets", async () => {
    const res = await request(
      "/compositions/studio-tile",
      "PUT",
      tileBody({
        a2ui: doc([
          { id: "root", component: "Stack", direction: "column", children: ["b"] },
          { id: "b", component: "Badge", children: "This badge text is far too long" },
        ]),
      }),
    );
    expect(res.status).toBe(422);
    const body = await json<ValidationReport & { error: string }>(res);
    expect(body.errors.map((e) => [e.layer, e.code, e.componentId])).toEqual([["rules", "DS-103", "b"]]);
    // Nothing was stored: the name from the last good save is still there.
    const records = await json<CompositionRecord[]>(await request("/compositions", "GET"));
    expect(records.find((r) => r.compositionId === "studio-tile")?.name).toBe("Studio Tile v2");
  });

  test("a composition may not contain a Slot", async () => {
    const res = await request("/compositions/studio-tile", "PUT", tileBody({ a2ui: pageDoc }));
    expect(res.status).toBe(422);
    const body = await json<ValidationReport>(res);
    expect(body.errors.map((e) => e.code)).toContain("not-allowed-in-kind");
  });
});

describe("composition history and delete impact", () => {
  test("versions come back newest first, saved by the studio", async () => {
    const history = await json<CompositionVersionSummary[]>(await request("/compositions/studio-tile/versions", "GET"));
    expect(history.map((v) => [v.version, v.savedBy])).toEqual([
      [2, "studio"],
      [1, "studio"],
    ]);
    expect(history[1]?.summary).toBe("Pasted the first draft");
  });

  test("delete impact names what cascades, and where the row came from", async () => {
    expect(await json<DeleteImpact>(await request("/compositions/studio-tile/delete-impact", "GET"))).toEqual({
      origin: "authored",
      placements: 0,
      savedVersions: 2,
    });
    expect(await json<DeleteImpact>(await request("/compositions/basic-plan-tile/delete-impact", "GET"))).toEqual({
      origin: "sample",
      placements: 3,
      savedVersions: 0,
    });
  });

  test("history and impact are 404 for a composition that does not exist", async () => {
    expect((await request("/compositions/nope/versions", "GET")).status).toBe(404);
    expect((await request("/compositions/nope/delete-impact", "GET")).status).toBe(404);
  });
});

describe("flows", () => {
  test("lists the sample flows and creates a new one", async () => {
    expect((await json<FlowRecord[]>(await request("/flows", "GET"))).map((f) => f.flowId)).toEqual([
      "aal",
      "order-summary",
      "pdp",
    ]);
    const res = await request("/flows/studio-flow", "PUT", { flowId: "studio-flow", name: "Studio Flow" });
    expect(await json<FlowRecord>(res)).toEqual({ flowId: "studio-flow", name: "Studio Flow" });
  });

  test("rejects an id that would make a surface id ambiguous", async () => {
    const res = await request("/flows/bad", "PUT", { flowId: "page:bad", name: "Bad" });
    expect(res.status).toBe(400);
  });
});

describe("PUT /v1/authoring/page-templates/:id", () => {
  test("derives slots from the document's Slot nodes", async () => {
    const res = await request("/page-templates/studio-page", "PUT", {
      pageTemplateId: "studio-page",
      flowId: "studio-flow",
      name: "Studio Page",
      description: "A page authored in the Studio.",
      a2ui: pageDoc,
    });
    expect(res.status).toBe(200);
    const saved = await json<{ record: PageTemplateRecord }>(res);
    expect(saved.record.slots).toEqual(["plan-summary"]);
    expect(saved.record.origin).toBe("authored");
  });

  test("an unknown flow is the caller's mistake, not a 500", async () => {
    const res = await request("/page-templates/studio-page", "PUT", {
      pageTemplateId: "studio-page",
      flowId: "no-such-flow",
      name: "Studio Page",
      a2ui: pageDoc,
    });
    expect(res.status).toBe(400);
    const body = await json<{ error: string; flows: string[] }>(res);
    expect(body.error).toMatch(/Unknown flow/);
    expect(body.flows).toContain("pdp");
  });

  test("lists pages with samples still marked as samples", async () => {
    const pages = await json<PageTemplateRecord[]>(await request("/page-templates", "GET"));
    const byId = new Map(pages.map((p) => [p.pageTemplateId, p]));
    expect(byId.get("pdp-mock")?.origin).toBe("sample");
    expect(byId.get("studio-page")?.origin).toBe("authored");
  });
});

describe("placements", () => {
  const placement = {
    compositionId: "studio-tile",
    pageTemplateId: "studio-page",
    slotId: "plan-summary",
    position: 0,
  };

  test("a placement must name a slot the page actually declares", async () => {
    const res = await request("/placements", "PUT", { ...placement, slotId: "promo-rail" });
    expect(res.status).toBe(400);
    const body = await json<{ error: string; slots: string[] }>(res);
    expect(body.error).toMatch(/has no slot "promo-rail"/);
    expect(body.slots).toEqual(["plan-summary"]);
  });

  test("an unknown page or composition is a 404, not a foreign key error", async () => {
    expect((await request("/placements", "PUT", { ...placement, pageTemplateId: "nope" })).status).toBe(404);
    expect((await request("/placements", "PUT", { ...placement, compositionId: "nope" })).status).toBe(404);
  });

  test("setting a placement returns the page's mappings, and setting it again updates in place", async () => {
    expect(await json<PlacementRecord[]>(await request("/placements", "PUT", placement))).toEqual([placement]);
    const updated = await json<PlacementRecord[]>(
      await request("/placements", "PUT", { ...placement, variant: "compact", position: 1 }),
    );
    expect(updated).toEqual([{ ...placement, variant: "compact", position: 1 }]);
    expect(await json<PlacementRecord[]>(await request("/page-templates/studio-page/placements", "GET"))).toEqual(
      updated,
    );
  });

  test("deleting a placement leaves the page with none", async () => {
    const res = await request("/placements", "DELETE", {
      compositionId: "studio-tile",
      pageTemplateId: "studio-page",
      slotId: "plan-summary",
    });
    expect(res.status).toBe(204);
    expect(await json<PlacementRecord[]>(await request("/page-templates/studio-page/placements", "GET"))).toEqual([]);
  });

  test("deleting a page template is a 204 once and a 404 after", async () => {
    expect((await request("/page-templates/studio-page", "DELETE")).status).toBe(204);
    expect((await request("/page-templates/studio-page", "DELETE")).status).toBe(404);
  });
});

describe("POST /v1/authoring/validate", () => {
  test("a good composition has no findings", async () => {
    const res = await request("/validate", "POST", { a2ui: tileDoc, kind: "composition" });
    expect(res.status).toBe(200);
    expect(await json<ValidationReport>(res)).toEqual({ errors: [], warnings: [] });
  });

  test("the same document passes as a page and fails as a composition, because of Slot", async () => {
    const asPage = await json<ValidationReport>(await request("/validate", "POST", { a2ui: pageDoc, kind: "page" }));
    expect(asPage.errors).toEqual([]);
    const asComposition = await json<ValidationReport>(await request("/validate", "POST", { a2ui: pageDoc }));
    expect(asComposition.errors.map((e) => e.code)).toContain("not-allowed-in-kind");
  });

  test("reports on half-typed input instead of rejecting it", async () => {
    // What the Studio sends while someone is still pasting.
    const res = await request("/validate", "POST", { a2ui: { a2ui: [{ version: "v0.8" }] } });
    expect(res.status).toBe(200);
    const report = await json<ValidationReport>(res);
    expect(report.errors.map((e) => e.code)).toContain("bad-version");
    expect(report.errors.every((e) => e.severity === "error")).toBe(true);
  });

  test("still rejects a request that is not a validate request at all", async () => {
    expect((await request("/validate", "POST", { kind: "sideways", a2ui: {} })).status).toBe(400);
  });
});

describe("POST /v1/authoring/samples/import", () => {
  test("adds nothing when the samples are all present", async () => {
    expect(await json<Record<string, number>>(await request("/samples/import", "POST"))).toEqual({
      compositions: 0,
      flows: 0,
      pageTemplates: 0,
      placements: 0,
    });
  });

  test("brings a deleted sample back, and leaves authored content alone", async () => {
    expect((await request("/compositions/home-plan-tile", "DELETE")).status).toBe(204);
    const counts = await json<Record<string, number>>(await request("/samples/import", "POST"));
    expect(counts.compositions).toBe(1);

    const records = await json<CompositionRecord[]>(await request("/compositions", "GET"));
    const ids = records.map((r) => r.compositionId);
    expect(ids).toContain("home-plan-tile");
    expect(ids).toContain("studio-tile");
    // Re-imported, so it is a sample again rather than keeping a stale origin.
    expect(records.find((r) => r.compositionId === "home-plan-tile")?.origin).toBe("sample");
  });
});

describe("DELETE /v1/authoring/compositions/:id", () => {
  test("deletes once, 404s after, and drops the picker cache", async () => {
    expect((await request("/compositions/studio-tile", "DELETE")).status).toBe(204);
    expect((await request("/compositions/studio-tile", "DELETE")).status).toBe(404);
    const picker = await json<{ compositionId: string }[]>(await app.request("/v1/compositions"));
    expect(picker.map((c) => c.compositionId)).not.toContain("studio-tile");
  });
});

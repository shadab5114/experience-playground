import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type pg from "pg";
import {
  AgentEvent,
  TERMINAL_EVENT_TYPES,
  type CompositionDetail,
  type CompositionSummary,
  type PlacementView,
} from "@experience-agent/contract";
import { PostgresCompositionStore } from "@experience-agent/postgres";
import { resetTestDatabase, testConnection } from "../../../../adapters/postgres/testing";
import { createPool, PostgresThreadLock } from "@experience-agent/postgres";
import { createRecordingLog, createScriptedModel, createTestEngine } from "../../../../adapters/langgraph/src/testing";
import { createVdsCatalog, readPackSettings } from "@experience-agent/vds-pack";
import { createFileGuidelineSource } from "@experience-agent/guidelines";
import type { AgentEngine } from "@experience-agent/core";
import { createApp } from "./app";
import { withListCache } from "../cache";

// Engines that are never asked to run (health and read-only tests).
const unusedEngine: AgentEngine = {
  run() {
    throw new Error("the engine should not run in this test");
  },
};

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let pool: pg.Pool;
let lockPool: pg.Pool;
let app: ReturnType<typeof createApp>;

// The seed composition is a valid draft, so a scripted "no change" edit passes validation.
let seedDoc: CompositionDetail["a2ui"];

const validBody = () => ({
  experienceId: "basic-plan-mobile",
  compositionId: "basic-plan-tile",
  currentA2ui: seedDoc,
  prompt: "make the badge smaller",
});

function post(body: unknown, threadId = "thread-1") {
  return app.request(`/v1/threads/${threadId}/prompts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  pool = await resetTestDatabase();
  lockPool = createPool(testConnection(), { max: 5, connectionTimeoutMillis: 1_000 });
  const store = withListCache(new PostgresCompositionStore(pool, "vds"), 30_000);
  seedDoc = (await new PostgresCompositionStore(pool, "vds").get("basic-plan-tile"))!.a2ui;
  const model = createScriptedModel([
    { kind: "edit", components: ["Badge"], topic: "backgroundColor", message: "" },
    { kind: "edit", a2ui: seedDoc, summary: "No change needed", message: "No change needed.", reason: null, alternatives: [] },
  ]);
  app = createApp({
    compositions: store,
    pingDatabase: () => pool.query("select 1").then(() => undefined),
    engine: createTestEngine({
      model,
      catalog: createVdsCatalog(),
      guidelines: createFileGuidelineSource(readPackSettings().guidelineStubFile),
      compositions: new PostgresCompositionStore(pool, "vds"),
      log: createRecordingLog(),
    }),
    threadLock: new PostgresThreadLock(lockPool),
    log: createRecordingLog(),
  });
});

afterAll(async () => {
  await Promise.all([pool.end(), lockPool.end()]);
});

describe("health", () => {
  test("reports ok when the database answers", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  test("reports 503 when the database is unreachable", async () => {
    const down = createApp({
      compositions: withListCache(new PostgresCompositionStore(pool, "vds"), 0),
      pingDatabase: () => Promise.reject(new Error("down")),
      engine: unusedEngine,
      threadLock: new PostgresThreadLock(lockPool),
      log: createRecordingLog(),
    });
    const res = await down.request("/health");
    expect(res.status).toBe(503);
  });
});

describe("composition reads (no model)", () => {
  test("list returns summaries and honours filters", async () => {
    const all = await (await app.request("/v1/compositions")).json();
    expect(all).toHaveLength(3);
    const plans = await json<CompositionSummary[]>(await app.request("/v1/compositions?type=plan-tile&q=home"));
    expect(plans.map((c) => c.compositionId)).toEqual(["home-plan-tile"]);
  });

  test("an empty filter value is treated as absent", async () => {
    const res = await app.request("/v1/compositions?type=&q=");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(3);
  });

  test("detail returns the A2UI document", async () => {
    const res = await app.request("/v1/compositions/basic-plan-tile");
    expect(res.status).toBe(200);
    const body = await json<CompositionDetail>(res);
    expect(body.a2ui.a2ui[0]).toMatchObject({ version: "v0.9" });
  });

  test("detail and placements return 404 for an unknown composition", async () => {
    expect((await app.request("/v1/compositions/nope")).status).toBe(404);
    expect((await app.request("/v1/compositions/nope/placements")).status).toBe(404);
  });

  test("placements list the pages the composition appears on", async () => {
    const res = await app.request("/v1/compositions/basic-plan-tile/placements");
    const placements = await json<PlacementView[]>(res);
    expect(placements.map((p) => p.pageTemplateId)).toEqual([
      "pdp-mock",
      "aal-mock",
      "order-summary-mock",
    ]);
  });

  test("composition reads answer in under 200 ms", async () => {
    const started = performance.now();
    await app.request("/v1/compositions/basic-plan-tile/placements");
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("POST /v1/threads/:threadId/prompts", () => {
  test("rejects a malformed body with 400 before any stream starts", async () => {
    // A composition without its document is malformed; a bare prompt is a valid chat-first start.
    const res = await post({ compositionId: "basic-plan-tile", prompt: "no document here" });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("rejects non-JSON with 400", async () => {
    expect((await post("not json")).status).toBe(400);
  });

  test("streams status events then exactly one terminal result", async () => {
    const res = await post(validBody());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = text
      .split("\n\n")
      .filter(Boolean)
      .map((block) => {
        const eventLine = block.split("\n").find((l) => l.startsWith("event: "))!;
        const dataLine = block.split("\n").find((l) => l.startsWith("data: "))!;
        expect(eventLine.slice(7)).toBe(JSON.parse(dataLine.slice(6)).type);
        return AgentEvent.parse(JSON.parse(dataLine.slice(6)));
      });

    // Four steps (route, gather, generate, validate), each announced running and done.
    expect(events.filter((e) => e.type === "status")).toHaveLength(8);
    const terminal = events.filter((e) => (TERMINAL_EVENT_TYPES as readonly string[]).includes(e.type));
    expect(terminal).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("result");
    expect(terminal[0]).toMatchObject({ type: "result", a2ui: seedDoc });
  });
});

describe("one run per thread", () => {
  // Each test gets a fresh gate. The engine holds its run until the gate opens,
  // so the thread lock stays taken for as long as the test needs.
  let release!: () => void;
  let gate: Promise<void>;
  const gatedEngine: AgentEngine = {
    async *run() {
      await gate;
      yield { type: "error", message: "finished", retryable: false };
    },
  };
  let gated: ReturnType<typeof createApp>;

  beforeAll(() => {
    gated = createApp({
      compositions: new PostgresCompositionStore(pool, "vds"),
      pingDatabase: () => pool.query("select 1").then(() => undefined),
      engine: gatedEngine,
      threadLock: new PostgresThreadLock(lockPool),
      log: createRecordingLog(),
    });
  });

  beforeEach(() => {
    gate = new Promise<void>((resolve) => (release = resolve));
  });

  const send = (threadId: string) =>
    gated.request(`/v1/threads/${threadId}/prompts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });

  test("a second prompt on a busy thread gets 409", async () => {
    const first = await send("busy-thread");
    expect(first.status).toBe(200);

    const second = await send("busy-thread");
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "A prompt is already running on this thread." });

    release();
    await first.text();
  });

  test("different threads run at the same time", async () => {
    // Both runs are held by the gate here, so both must already be running.
    const a = await send("parallel-a");
    const b = await send("parallel-b");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    release();
    await Promise.all([a.text(), b.text()]);
  });

  test("the thread is free again once its run has ended", async () => {
    const first = await send("reuse-thread");
    release();
    await first.text();

    const again = await send("reuse-thread");
    expect(again.status).toBe(200);
    release();
    await again.text();
  });
});

describe("browser access (CORS) and placements", () => {
  test("allows the playground dev origin on API routes", async () => {
    const res = await app.request("/v1/compositions", { headers: { origin: "http://localhost:5173" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  test("answers the preflight for a prompt POST from the dev origin", async () => {
    const res = await app.request("/v1/threads/t1/prompts", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  test("gives no allow-origin header to other origins", async () => {
    const res = await app.request("/v1/compositions", { headers: { origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("placements include flowId for the impacts tabs", async () => {
    const placements = await json<PlacementView[]>(await app.request("/v1/compositions/basic-plan-tile/placements"));
    expect(placements.map((p) => p.flowId)).toEqual(["pdp", "aal", "order-summary"]);
  });
});

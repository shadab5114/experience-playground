// Thread memory lives in Postgres, so it survives a restart: a second engine built
// on the same database picks up the conversation the first one started.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { AgentRequest, type A2UIDocument, type AgentEvent } from "@experience-agent/contract";
import { PostgresCompositionStore } from "@experience-agent/postgres";
import { createVdsCatalog, readPackSettings } from "@experience-agent/vds-pack";
import { createFileGuidelineSource } from "@experience-agent/guidelines";
import { resetTestDatabase } from "../../postgres/testing";
import { createPostgresCheckpointer } from "./index";
import { createRecordingLog, createScriptedModel, createTestEngine } from "./testing";

const catalog = createVdsCatalog();
const guidelines = createFileGuidelineSource(readPackSettings().guidelineStubFile);
let pool: pg.Pool;
let store: PostgresCompositionStore;
let seedDoc: A2UIDocument;

beforeAll(async () => {
  pool = await resetTestDatabase();
  store = new PostgresCompositionStore(pool, "vds");
  seedDoc = (await store.get("basic-plan-tile"))!.a2ui;
});

afterAll(async () => {
  await pool.end();
});

const request = (prompt: string) =>
  AgentRequest.parse({ experienceId: "basic-plan-mobile", compositionId: "basic-plan-tile", currentA2ui: seedDoc, prompt });

const route = { kind: "edit", components: ["Badge"], topic: "backgroundColor", message: "" };
const edit = (summary: string) => ({
  kind: "edit",
  a2ui: seedDoc,
  summary,
  message: summary,
  reason: null,
  alternatives: [],
});

async function run(engine: ReturnType<typeof createTestEngine>, threadId: string, prompt: string) {
  const events: AgentEvent[] = [];
  for await (const e of engine.run({ request: request(prompt), threadId })) events.push(e);
  return events;
}

describe("Postgres checkpointer", () => {
  test("creates its tables and keeps thread memory across an engine restart", async () => {
    const first = createTestEngine({
      model: createScriptedModel([route, edit("Kept the cap grey")]),
      catalog,
      guidelines,
      compositions: store,
      log: createRecordingLog(),
      checkpointer: await createPostgresCheckpointer(pool),
    });
    await run(first, "restart-thread", "Keep the cap grey");

    // A new saver and a new engine on the same database: nothing shared in memory.
    const model = createScriptedModel([route, edit("Cap stays grey")]);
    const second = createTestEngine({
      model,
      catalog,
      guidelines,
      compositions: store,
      log: createRecordingLog(),
      checkpointer: await createPostgresCheckpointer(pool),
    });
    await run(second, "restart-thread", "Now make it bolder");

    expect(model.calls[0]!.messages.slice(0, 2)).toEqual([
      { role: "user", content: "Keep the cap grey" },
      { role: "assistant", content: "Kept the cap grey" },
    ]);
  });

  test("a different thread starts with no memory", async () => {
    const model = createScriptedModel([route, edit("Fresh")]);
    const engine = createTestEngine({
      model,
      catalog,
      guidelines,
      compositions: store,
      log: createRecordingLog(),
      checkpointer: await createPostgresCheckpointer(pool),
    });
    await run(engine, "brand-new-thread", "Hello");
    expect(model.calls[0]!.messages).toHaveLength(1);
  });
});

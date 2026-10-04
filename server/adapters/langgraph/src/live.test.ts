// Opt-in live test. Sends the golden prompts to the real model and checks the
// outcome type and that the validator passes. It does not compare JSON, because
// a real model's wording and layout vary from run to run.
//
// Runs only when LIVE_MODEL_TESTS=1, with ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY and
// MODEL_ID set (server/.env is loaded by the Vitest config). Costs real tokens.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { AgentRequest, type AgentEvent, TERMINAL_EVENT_TYPES } from "@experience-agent/contract";
import { blocking, validate } from "@experience-agent/core";
import { PostgresCompositionStore } from "@experience-agent/postgres";
import { createAnthropicModel } from "@experience-agent/anthropic";
import { createVdsCatalog, readPackSettings } from "@experience-agent/vds-pack";
import { createFileGuidelineSource } from "@experience-agent/guidelines";
import { resetTestDatabase } from "../../postgres/testing";
import { createRecordingLog, createTestEngine } from "./testing";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, "../../../ds-packs/vds/golden/graph");

interface GoldenFixture {
  name: string;
  compositionId: string;
  prompt: string;
  expect: { type: "result" | "scope" };
}

const fixtures = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => ({ file, golden: JSON.parse(readFileSync(join(GOLDEN_DIR, file), "utf8")) as GoldenFixture }));

const live = process.env.LIVE_MODEL_TESTS === "1";

describe.skipIf(!live)("live model (LIVE_MODEL_TESTS=1)", () => {
  const catalog = createVdsCatalog();
  const guidelines = createFileGuidelineSource(readPackSettings().guidelineStubFile);
  let pool: pg.Pool;
  let store: PostgresCompositionStore;

  beforeAll(async () => {
    const { ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, MODEL_ID } = process.env;
    if (!ANTHROPIC_BASE_URL || !ANTHROPIC_API_KEY || !MODEL_ID) {
      throw new Error("LIVE_MODEL_TESTS=1 needs ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY and MODEL_ID set");
    }
    pool = await resetTestDatabase();
    store = new PostgresCompositionStore(pool, "vds");
  });

  afterAll(async () => {
    await pool?.end();
  });

  for (const { file, golden } of fixtures) {
    test(`${file}: ${golden.name}`, async () => {
      const composition = await store.get(golden.compositionId);
      if (!composition) throw new Error(`seed has no ${golden.compositionId}`);
      const request = AgentRequest.parse({
        experienceId: "basic-plan-mobile",
        compositionId: golden.compositionId,
        currentA2ui: composition.a2ui,
        prompt: golden.prompt,
      });

      const model = createAnthropicModel({
        baseURL: process.env.ANTHROPIC_BASE_URL!,
        apiKey: process.env.ANTHROPIC_API_KEY!,
        model: process.env.MODEL_ID!,
        timeoutMs: 120_000,
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { workspaceId: process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      });
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

      const events: AgentEvent[] = [];
      for await (const e of engine.run({ request, threadId: `live-${file}-${Date.now()}` })) events.push(e);

      const terminals = events.filter((e) => (TERMINAL_EVENT_TYPES as readonly string[]).includes(e.type));
      expect(terminals).toHaveLength(1);
      const [terminal] = terminals;
      expect(terminal!.type).toBe(golden.expect.type);

      if (terminal!.type === "result") {
        const errors = blocking(validate(terminal!.a2ui, { kind: "composition", catalog, current: composition.a2ui }));
        expect(errors).toEqual([]);
      }
    }, 180_000);
  }
});

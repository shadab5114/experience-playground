// Golden scenarios for VDS: the approved cap color, the highlight price difference
// and the smaller badge. Each fixture in ds-packs/vds/golden/graph holds the model
// replies (derived from the playground scenarios) and the result the graph must send.
// The validator runs for real, so a draft the VDS rules reject fails here.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { AgentRequest, type A2UIDocument, type AgentEvent } from "@experience-agent/contract";
import { PostgresCompositionStore } from "@experience-agent/postgres";
import { createVdsCatalog, readPackSettings } from "@experience-agent/vds-pack";
import { createFileGuidelineSource } from "@experience-agent/guidelines";
import { resetTestDatabase } from "../../postgres/testing";
import { createRecordingLog, createScriptedModel, createTestEngine } from "./testing";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, "../../../ds-packs/vds/golden/graph");

type GoldenExpect =
  | { type: "result"; summary: string; message: string; repairs: number }
  | { type: "scope"; message: string; repairs: 0 };

interface GoldenFixture {
  name: string;
  source: string;
  compositionId: string;
  prompt: string;
  replies: unknown[];
  expect: GoldenExpect;
}

const fixtures = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => ({ file, golden: JSON.parse(readFileSync(join(GOLDEN_DIR, file), "utf8")) as GoldenFixture }));

const catalog = createVdsCatalog();
const guidelines = createFileGuidelineSource(readPackSettings().guidelineStubFile);
let pool: pg.Pool;
let store: PostgresCompositionStore;

beforeAll(async () => {
  pool = await resetTestDatabase();
  store = new PostgresCompositionStore(pool, "vds");
});

afterAll(async () => {
  await pool.end();
});

describe("golden scenarios", () => {
  test("there is a fixture for each approved scenario and for the scope notice", () => {
    expect(fixtures.map((f) => f.golden.name).sort()).toEqual([
      "approved cap color (red)",
      "highlight price difference",
      "scope: change the PDP header",
      "smaller badge",
    ]);
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

      const model = createScriptedModel(golden.replies);
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });
      const events: AgentEvent[] = [];
      for await (const e of engine.run({ request, threadId: `golden-${file}` })) events.push(e);

      if (golden.expect.type === "scope") {
        // A request outside the locked composition stops after route, with no model call past it.
        const stepped = events.flatMap((e) => (e.type === "status" && e.state === "done" ? [e.stepId] : []));
        expect(stepped).toEqual(["route"]);
        expect(events.at(-1)).toEqual({ type: "scope", message: golden.expect.message });
        expect(model.remaining()).toBe(0);
        return;
      }

      // Each repair is followed by another validation.
      const expectedSteps = [
        "route",
        "gather",
        "generate",
        "validate",
        ...Array.from({ length: golden.expect.repairs }).flatMap(() => ["repair", "validate"]),
      ];
      const stepped = events.flatMap((e) => (e.type === "status" && e.state === "done" ? [e.stepId] : []));
      expect(stepped).toEqual(expectedSteps);

      // The last reply is the draft the graph must send: a generate reply carries it
      // under `a2ui`; a repair reply is the document itself.
      const last = golden.replies.at(-1) as Record<string, unknown>;
      const draft = (("kind" in last ? last.a2ui : last) as A2UIDocument);
      const [terminal] = events.slice(-1);
      expect(terminal).toEqual({
        type: "result",
        a2ui: draft,
        summary: golden.expect.summary,
        message: golden.expect.message,
      });
      expect(model.remaining()).toBe(0);
    });
  }
});

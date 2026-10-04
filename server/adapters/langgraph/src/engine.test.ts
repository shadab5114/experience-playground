// The graph end to end with a scripted model, the real validator, the VDS catalog,
// the guideline stub and the Postgres composition store. No network.
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import type pg from "pg";
import {
  AgentEvent,
  AgentRequest,
  TERMINAL_EVENT_TYPES,
  type A2UIDocument,
} from "@experience-agent/contract";
import { runAgent } from "@experience-agent/core";
import { PostgresCompositionStore } from "@experience-agent/postgres";
import { createVdsCatalog, readPackSettings } from "@experience-agent/vds-pack";
import { createFileGuidelineSource } from "@experience-agent/guidelines";
import { resetTestDatabase } from "../../postgres/testing";
import { createRecordingLog, createScriptedModel, createTestEngine } from "./testing";

let pool: pg.Pool;
let store: PostgresCompositionStore;
const catalog = createVdsCatalog();
const guidelines = createFileGuidelineSource(readPackSettings().guidelineStubFile);
let seedDoc: A2UIDocument;

beforeAll(async () => {
  pool = await resetTestDatabase();
  store = new PostgresCompositionStore(pool, "vds");
  seedDoc = (await store.get("basic-plan-tile"))!.a2ui;
});

afterAll(async () => {
  await pool.end();
});

// Returns a copy of the seed with one component's props changed.
function withComponent(id: string, props: Record<string, unknown>): A2UIDocument {
  const doc = structuredClone(seedDoc);
  const msg = doc.a2ui.find((m) => "updateComponents" in m);
  if (!msg || !("updateComponents" in msg)) throw new Error("seed has no components");
  const node = msg.updateComponents.components.find((c) => c.id === id);
  if (!node) throw new Error(`seed has no component ${id}`);
  Object.assign(node, props);
  return doc;
}

const request = (prompt: string, compositionId = "basic-plan-tile") =>
  AgentRequest.parse({ experienceId: "basic-plan-mobile", compositionId, currentA2ui: seedDoc, prompt });

const routeReply = (kind: "edit" | "ask" | "scope" | "unsupported", extra: Record<string, unknown> = {}) => ({
  kind,
  components: ["Badge"],
  topic: "backgroundColor",
  message: "",
  ...extra,
});

const editReply = (a2ui: A2UIDocument, summary = "Changed the cap color", message = "Done.") => ({
  kind: "edit",
  a2ui,
  summary,
  message,
  reason: null,
  alternatives: [],
});

const refusalReply = (reason: string, alternatives: string[]) => ({
  kind: "refusal",
  a2ui: null,
  summary: null,
  message: null,
  reason,
  alternatives,
});

async function run(engine: ReturnType<typeof createTestEngine>, threadId: string, req: AgentRequest) {
  const events: AgentEvent[] = [];
  for await (const e of engine.run({ request: req, threadId })) events.push(e);
  return events;
}

const statuses = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === "status" ? [`${e.stepId}:${e.state}`] : []));
const terminals = (events: AgentEvent[]) =>
  events.filter((e) => (TERMINAL_EVENT_TYPES as readonly string[]).includes(e.type));

describe("agent graph", () => {
  test("an edit runs route, gather, generate and validate, then sends one result", async () => {
    const draft = withComponent("badge", { backgroundColor: "red" });
    const model = createScriptedModel([routeReply("edit"), editReply(draft, "Cap color changed to red")]);
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

    const events = await run(engine, "edit-1", request("Make the cap red"));

    expect(statuses(events)).toEqual([
      "route:running",
      "route:done",
      "gather:running",
      "gather:done",
      "generate:running",
      "generate:done",
      "validate:running",
      "validate:done",
    ]);
    expect(terminals(events)).toEqual([
      { type: "result", a2ui: draft, summary: "Cap color changed to red", message: "Done." },
    ]);
    expect(events.at(-1)?.type).toBe("result");
    expect(model.remaining()).toBe(0);
  });

  test("a draft that fails validation is repaired, then sent", async () => {
    const bad = withComponent("badge", { backgroundColor: "magenta" });
    const fixed = withComponent("badge", { backgroundColor: "red" });
    const model = createScriptedModel([routeReply("edit"), editReply(bad), fixed]);
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

    const events = await run(engine, "repair-1", request("Make the cap magenta"));

    expect(statuses(events)).toContain("repair:running");
    expect(statuses(events).filter((s) => s.startsWith("validate:done"))).toHaveLength(2);
    expect(terminals(events)).toMatchObject([{ type: "result", a2ui: fixed }]);
    expect(model.calls.map((c) => c.schemaName)).toContain("kind,components,topic,message,guidelineQueries,targetText");
  });

  test("after two repairs that still fail, the run ends with a retryable error and no tile", async () => {
    const bad = withComponent("badge", { backgroundColor: "magenta" });
    const model = createScriptedModel([routeReply("edit"), editReply(bad), bad, bad]);
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

    const events = await run(engine, "repair-fail", request("Make the cap magenta"));

    expect(statuses(events).filter((s) => s === "repair:running")).toHaveLength(2);
    expect(statuses(events).filter((s) => s === "validate:done")).toHaveLength(3);
    expect(terminals(events)).toEqual([
      {
        type: "error",
        message: "I couldn't make that change in a valid form. Try rephrasing the request.",
        retryable: true,
      },
    ]);
    expect(model.remaining()).toBe(0);
  });

  test("a refusal ends the run before validation", async () => {
    const model = createScriptedModel([
      routeReply("edit"),
      refusalReply("That color isn't in the approved palette.", ["Change the cap color to red"]),
    ]);
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

    const events = await run(engine, "refuse-1", request("Make the cap neon pink"));

    expect(statuses(events).some((s) => s.startsWith("validate"))).toBe(false);
    expect(terminals(events)).toEqual([
      {
        type: "refusal",
        reason: "That color isn't in the approved palette.",
        alternatives: ["Change the cap color to red"],
      },
    ]);
  });

  test("a request about another composition is a scope notice and never reaches gather", async () => {
    const model = createScriptedModel([
      routeReply("scope", { message: "This experience only edits the Basic Plan tile." }),
    ]);
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

    const events = await run(engine, "scope-1", request("Change the order summary"));

    expect(statuses(events)).toEqual(["route:running", "route:done"]);
    expect(terminals(events)).toEqual([{ type: "scope", message: "This experience only edits the Basic Plan tile." }]);
    expect(model.calls).toHaveLength(1);
  });

  test("an unknown composition is refused without a model call", async () => {
    const model = createScriptedModel([]);
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

    const events = await run(engine, "unknown-1", request("Make it blue", "no-such-composition"));

    expect(model.calls).toHaveLength(0);
    expect(terminals(events)).toEqual([
      { type: "refusal", reason: "That composition isn't available in this workspace.", alternatives: [] },
    ]);
  });

  test("a question is not answered yet and gets a non-retryable error", async () => {
    const model = createScriptedModel([routeReply("ask")]);
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

    const events = await run(engine, "ask-1", request("Which variants exist?"));

    expect(statuses(events).some((s) => s.startsWith("generate"))).toBe(false);
    expect(terminals(events)).toEqual([
      { type: "error", message: "Questions about compositions aren't answered yet.", retryable: false },
    ]);
  });

  test("a follow-up in the same thread sees the earlier conversation", async () => {
    const first = withComponent("badge", { backgroundColor: "red" });
    const second = withComponent("badge", { backgroundColor: "blue" });
    const model = createScriptedModel([routeReply("edit"), editReply(first, "Cap is red"), routeReply("edit"), editReply(second, "Cap is blue")]);
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

    await run(engine, "thread-memory", request("Make the cap red"));
    await run(engine, "thread-memory", request("Make it blue instead"));

    const secondRoute = model.calls[2]!;
    expect(secondRoute.messages.slice(0, 2)).toEqual([
      { role: "user", content: "Make the cap red" },
      { role: "assistant", content: "Cap is red" },
    ]);
    expect(secondRoute.messages.at(-1)?.content).toContain("Make it blue instead");
  });

  test("another thread does not see that conversation", async () => {
    const draft = withComponent("badge", { backgroundColor: "red" });
    const model = createScriptedModel([routeReply("edit"), editReply(draft), routeReply("edit"), editReply(draft)]);
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

    await run(engine, "thread-a", request("Make the cap red"));
    await run(engine, "thread-b", request("Make the cap red again"));

    expect(model.calls[2]!.messages).toHaveLength(1);
  });

  test("a binding warning is logged for operators and never sent to the client", async () => {
    const warned = structuredClone(seedDoc);
    const msg = warned.a2ui.find((m) => "updateComponents" in m) as { updateComponents: { components: Record<string, unknown>[] } };
    msg.updateComponents.components.find((c) => c.id === "eyebrow")!.children = { path: "/plan/missing" };
    const model = createScriptedModel([routeReply("edit"), editReply(warned)]);
    const log = createRecordingLog();
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log });

    const events = await run(engine, "warn-1", request("Tidy the eyebrow"));

    expect(terminals(events)[0]).toMatchObject({ type: "result" });
    expect(JSON.stringify(events)).not.toContain("unresolved-binding");
    expect(log.entries).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "validation-warning",
        fields: expect.objectContaining({ code: "unresolved-binding", compositionId: "basic-plan-tile" }),
      }),
    ]);
  });

  test("a model failure reaches the caller as one generic error, without the cause", async () => {
    const model = createScriptedModel([]);
    const log = createRecordingLog();
    const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log });

    const events: AgentEvent[] = [];
    for await (const e of runAgent(request("Make the cap red"), { threadId: "fail-1", engine, log })) events.push(e);

    expect(terminals(events)).toEqual([
      { type: "error", message: "The agent could not finish this request. Try again.", retryable: true },
    ]);
    expect(log.entries.map((e) => e.event)).toEqual(["agent-run-failed"]);
    expect(JSON.stringify(events)).not.toContain("scripted model");
  });

  test("a failed guideline lookup is logged and the run still sends a validated result", async () => {
    const draft = withComponent("badge", { backgroundColor: "red" });
    const model = createScriptedModel([routeReply("edit"), editReply(draft, "Cap color changed to red")]);
    const log = createRecordingLog();
    const failingGuidelines = {
      search: async () => {
        throw new Error("rag app is down");
      },
    };
    const engine = createTestEngine({ model, catalog, guidelines: failingGuidelines, compositions: store, log });

    const events = await run(engine, "guidelines-down", request("Make the cap red"));

    expect(terminals(events)).toEqual([
      { type: "result", a2ui: draft, summary: "Cap color changed to red", message: "Done." },
    ]);
    expect(log.entries).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "guidelines-unavailable",
        fields: expect.objectContaining({ query: 0, reason: "Error" }),
      }),
    ]);
  });

  test("guideline lookups use the questions the route wrote, never the user's words", async () => {
    const draft = withComponent("badge", { backgroundColor: "red" });
    const questions = ["Which Badge background colors are approved on a plan tile, and is red one of them?"];
    const model = createScriptedModel([
      { ...routeReply("edit"), guidelineQueries: questions },
      editReply(draft),
    ]);
    const asked: { query: string; components: string[] }[] = [];
    const recordingGuidelines = {
      search: async (q: { query: string; components: string[] }) => {
        asked.push(q);
        return [];
      },
    };
    const engine = createTestEngine({ model, catalog, guidelines: recordingGuidelines, compositions: store, log: createRecordingLog() });

    await run(engine, "queries-1", request("change cap color or badge to red"));

    expect(asked).toEqual([{ query: questions[0], components: ["Badge"] }]);
    expect(JSON.stringify(asked)).not.toContain("change cap color");
  });

  describe("chat-first start (no composition open)", () => {
    const chatRequest = (prompt: string) => AgentRequest.parse({ prompt });

    test("a typed request to open a tile goes straight to find and sends a switch", async () => {
      const model = createScriptedModel([
        { kind: "switch", components: [], topic: null, message: "", guidelineQueries: [], targetText: "home plan" },
      ]);
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

      const events = await run(engine, "chat-first-switch", chatRequest("show me home plan"));

      expect(statuses(events)).toEqual(["route:running", "route:done", "find:running", "find:done"]);
      expect(terminals(events)).toEqual([
        {
          type: "switch",
          compositionId: "home-plan-tile",
          name: "Home Plan",
          message: "Opening Home Plan. Unsaved work in this task will be discarded.",
        },
      ]);
    });

    test("an edit with no composition open is sent back to choose one, with no edit work", async () => {
      const model = createScriptedModel([
        { kind: "edit", components: ["Badge"], topic: "backgroundColor", message: "", guidelineQueries: [], targetText: null },
      ]);
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

      const events = await run(engine, "chat-first-edit", chatRequest("make the badge red"));

      expect(statuses(events).some((s) => s.startsWith("gather") || s.startsWith("generate"))).toBe(false);
      expect(terminals(events)).toEqual([
        {
          type: "refusal",
          reason: 'Tell me which composition to open first, for example "show me home plan".',
          alternatives: [],
        },
      ]);
      expect(model.calls).toHaveLength(1);
    });
  });

  describe("switching composition", () => {
    const switchReply = (targetText: string) => ({
      kind: "switch",
      components: [],
      topic: null,
      message: "",
      guidelineQueries: [],
      targetText,
    });

    test("a name that matches one composition sends a switch event and no model call past route", async () => {
      const model = createScriptedModel([switchReply("Basic Plan Tile")]);
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

      const events = await run(engine, "switch-1", request("bring me Basic Plan Tile", "home-plan-tile"));

      expect(statuses(events)).toEqual(["route:running", "route:done", "find:running", "find:done"]);
      expect(terminals(events)).toEqual([
        {
          type: "switch",
          compositionId: "basic-plan-tile",
          name: "Basic Plan – Mobile",
          message: "Opening Basic Plan – Mobile. Unsaved work in this task will be discarded.",
        },
      ]);
      expect(model.remaining()).toBe(0);
    });

    test("when the extracted name matches nothing, the designer's own words are searched instead", async () => {
      // The route sometimes adds words the designer did not use. The prompt's words still find the tile.
      const model = createScriptedModel([switchReply("Home Plan – Mobile")]);
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

      const events = await run(engine, "switch-fallback", request("show me home plan"));

      expect(terminals(events)).toEqual([
        {
          type: "switch",
          compositionId: "home-plan-tile",
          name: "Home Plan",
          message: "Opening Home Plan. Unsaved work in this task will be discarded.",
        },
      ]);
    });

    test("asking for the composition already open is an answer, not a switch", async () => {
      const model = createScriptedModel([switchReply("Basic Plan Tile")]);
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

      const events = await run(engine, "switch-same", request("bring me Basic Plan Tile"));

      expect(terminals(events)).toEqual([{ type: "answer", text: "Basic Plan – Mobile is already open." }]);
    });

    test("a name with no match is an answer that says so", async () => {
      const model = createScriptedModel([switchReply("Premium Gold Tile")]);
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

      const events = await run(engine, "switch-none", request("bring me Premium Gold Tile"));

      expect(terminals(events)).toEqual([
        { type: "answer", text: `I couldn't find a composition called "Premium Gold Tile" in this design system.` },
      ]);
    });

    test("several matches are settled by the model, which may pick only one of them", async () => {
      const model = createScriptedModel([
        switchReply("Plan Tile"),
        { compositionId: "home-plan-tile", message: "" },
      ]);
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

      const events = await run(engine, "switch-pick", request("bring me the plan tile"));

      expect(terminals(events)).toEqual([
        {
          type: "switch",
          compositionId: "home-plan-tile",
          name: "Home Plan",
          message: "Opening Home Plan. Unsaved work in this task will be discarded.",
        },
      ]);
    });

    test("when the model picks an id that was not offered, the designer is asked instead", async () => {
      const model = createScriptedModel([
        switchReply("Plan Tile"),
        { compositionId: "made-up-tile", message: "Which plan tile did you mean?" },
      ]);
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });

      const events = await run(engine, "switch-bad-pick", request("bring me the plan tile"));

      expect(terminals(events)).toEqual([{ type: "answer", text: "Which plan tile did you mean?" }]);
    });
  });

  // S8: the prose people write in the Studio has to reach the model, or the
  // "agent rules" field is decoration. These assert on the prompt the generate
  // node builds, because that is the only place a rule can take effect — rules
  // steer the model and are deliberately not enforced by the validator.
  describe("authored rules reach the generator", () => {
    const rule = "Never change the price text. The Badge may only be red or neonYellow.";

    const runEdit = async (threadId: string) => {
      const model = createScriptedModel([
        routeReply("edit", { guidelineQueries: ["Which background colors are approved for a Badge?"] }),
        editReply(withComponent("badge", { backgroundColor: "red" })),
      ]);
      const engine = createTestEngine({ model, catalog, guidelines, compositions: store, log: createRecordingLog() });
      await run(engine, threadId, request("make the cap red"));
      // The generate call is the one answered with the GenerateSchema.
      const generateCall = model.calls.at(-1)!;
      return generateCall.messages.at(-1)!.content;
    };

    test("a composition with rules has them in the generate prompt, after the guidelines", async () => {
      await pool.query("update compositions set agent_rules = $1 where id = $2", [rule, "basic-plan-tile"]);

      const prompt = await runEdit("rules-present");

      expect(prompt).toContain(rule);
      // Most specific last: a rule must not be buried above the guidelines it
      // is meant to override.
      expect(prompt.indexOf(rule)).toBeGreaterThan(prompt.indexOf("Guidelines (cite the sourceId in a refusal):"));
      expect(prompt).toContain("written by its author");
    });

    test("a composition with no rules gets no rules section at all", async () => {
      await pool.query("update compositions set agent_rules = null where id = $1", ["basic-plan-tile"]);

      const prompt = await runEdit("rules-absent");

      expect(prompt).not.toContain("written by its author");
      expect(prompt).toContain("Guidelines (cite the sourceId in a refusal):");
    });

    test("whitespace-only rules count as none", async () => {
      await pool.query("update compositions set agent_rules = $1 where id = $2", ["     ", "basic-plan-tile"]);

      const prompt = await runEdit("rules-blank");

      expect(prompt).not.toContain("written by its author");
    });
  });
});

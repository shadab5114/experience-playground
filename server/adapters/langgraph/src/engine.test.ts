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
    expect(model.calls.map((c) => c.schemaName)).toContain("kind,components,topic,message");
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
});

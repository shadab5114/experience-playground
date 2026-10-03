import { describe, expect, test } from "vitest";
import { AgentEvent, AgentRequest, TERMINAL_EVENT_TYPES, type A2UIDocument } from "@experience-agent/contract";
import { runAgent } from "./runAgent";
import type { AgentEngine, Logger } from "./ports";

const doc: A2UIDocument = {
  a2ui: [{ version: "v0.9", createSurface: { surfaceId: "main", catalogId: "x" } }],
};

const request = AgentRequest.parse({
  experienceId: "basic-plan-mobile",
  compositionId: "basic-plan-tile",
  currentA2ui: doc,
  prompt: "make the badge smaller",
});

const status = (stepId: "route", state: "running" | "done"): AgentEvent => ({
  type: "status",
  stepId,
  label: "Understanding your request",
  state,
});
const result: AgentEvent = { type: "result", a2ui: doc, summary: "Done", message: "Done." };

const silentLog: Logger & { errors: string[] } = {
  errors: [],
  warn() {},
  error(event) {
    this.errors.push(event);
  },
};

// An engine that plays back the given events, optionally failing afterwards.
function engineYielding(events: AgentEvent[], then?: () => never): AgentEngine {
  return {
    async *run() {
      for (const e of events) yield e;
      if (then) then();
    },
  };
}

async function collect(engine: AgentEngine, signal?: AbortSignal, log: Logger = silentLog) {
  const out: AgentEvent[] = [];
  for await (const e of runAgent(request, { threadId: "t1", engine, log, signal })) out.push(e);
  return out;
}

describe("runAgent", () => {
  test("passes the engine's events through in order", async () => {
    const events = [status("route", "running"), status("route", "done"), result];
    expect(await collect(engineYielding(events))).toEqual(events);
  });

  test("drops anything after the first terminal event", async () => {
    const late: AgentEvent = { type: "error", message: "late", retryable: false };
    const out = await collect(engineYielding([result, late]));
    expect(out).toEqual([result]);
  });

  test("turns an engine failure into one generic, retryable error and logs only the error name", async () => {
    const logged: { event: string; fields: unknown }[] = [];
    const logger: Logger = {
      warn() {},
      error(event, fields) {
        logged.push({ event, fields });
      },
    };
    const engine = engineYielding([status("route", "running")], () => {
      throw new TypeError("model key sk-test-123 rejected");
    });
    const out = await collect(engine, undefined, logger);
    expect(out.at(-1)).toEqual({
      type: "error",
      message: "The agent could not finish this request. Try again.",
      retryable: true,
    });
    expect(out.filter((e) => (TERMINAL_EVENT_TYPES as readonly string[]).includes(e.type))).toHaveLength(1);
    expect(logged.map((l) => l.event)).toEqual(["agent-run-failed"]);
    expect(JSON.stringify(logged)).not.toContain("sk-test-123");
  });

  test("adds a generic error when the engine ends without a terminal event", async () => {
    const out = await collect(engineYielding([status("route", "done")]));
    expect(out.at(-1)).toMatchObject({ type: "error", retryable: true });
  });

  test("stops without a terminal event when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await collect(engineYielding([result]), controller.signal)).toEqual([]);
  });
});

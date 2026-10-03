// Test helpers: a scripted model that answers from a queue, a recording logger,
// and an engine built with the in-memory checkpointer. No network, no database.
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import type { ZodType } from "zod";
import {
  makeNodes,
  type AgentEngine,
  type CatalogSource,
  type ChatMessage,
  type CompositionStore,
  type GuidelineSource,
  type Logger,
  type ModelClient,
} from "@experience-agent/core";
import { createAgentEngine } from "./index";

export interface ScriptedModel extends ModelClient {
  // Every call the graph made, in order.
  readonly calls: { system: string; messages: ChatMessage[]; schemaName: string }[];
  remaining(): number;
}

// Answers each structured call with the next queued reply. A reply that does not
// match the step's schema fails the test loudly rather than being repaired silently.
export function createScriptedModel(replies: unknown[]): ScriptedModel {
  const queue = [...replies];
  const calls: ScriptedModel["calls"] = [];
  return {
    calls,
    remaining: () => queue.length,
    async structured<T>({ system, messages, schema }: { system: string; messages: ChatMessage[]; schema: ZodType<T> }) {
      calls.push({ system, messages: [...messages], schemaName: schemaLabel(schema) });
      if (queue.length === 0) throw new Error("scripted model: no reply left for this call");
      const parsed = schema.safeParse(queue.shift());
      if (!parsed.success) throw new Error(`scripted reply does not match the schema: ${parsed.error.message}`);
      return parsed.data;
    },
  };
}

// Tells the schemas apart in the recorded calls by their first field.
function schemaLabel(schema: ZodType<unknown>): string {
  const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
  return shape ? Object.keys(shape).join(",") : "unknown";
}

export interface RecordingLog extends Logger {
  readonly entries: { level: "warn" | "error"; event: string; fields: Record<string, unknown> }[];
}

export function createRecordingLog(): RecordingLog {
  const entries: RecordingLog["entries"] = [];
  return {
    entries,
    warn: (event, fields) => entries.push({ level: "warn", event, fields }),
    error: (event, fields) => entries.push({ level: "error", event, fields }),
  };
}

export function createTestEngine(parts: {
  model: ModelClient;
  catalog: CatalogSource;
  guidelines: GuidelineSource;
  compositions: CompositionStore;
  log: Logger;
  systemPrompt?: string;
  // Defaults to the in-memory saver; pass the Postgres one to test persistence.
  checkpointer?: BaseCheckpointSaver;
}): AgentEngine {
  const nodes = makeNodes({
    model: parts.model,
    catalog: parts.catalog,
    guidelines: parts.guidelines,
    compositions: parts.compositions,
    pack: { systemPrompt: parts.systemPrompt ?? "test system prompt", compositionTypes: ["plan-tile", "summary-tile"] },
    log: parts.log,
  });
  return createAgentEngine({ nodes, checkpointer: parts.checkpointer ?? new MemorySaver() });
}

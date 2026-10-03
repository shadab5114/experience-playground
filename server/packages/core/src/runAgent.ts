// The one function both doors call (HTTP now, A2A later). It hands the run to
// the engine and enforces the stream contract: exactly one terminal event,
// nothing after it, and a generic error if the engine fails.
import type { AgentEvent, AgentRequest } from "@experience-agent/contract";
import { TERMINAL_EVENT_TYPES } from "@experience-agent/contract";
import type { AgentEngine, Logger } from "./ports";

export interface RunOptions {
  threadId: string;
  engine: AgentEngine;
  log: Logger;
  signal?: AbortSignal;
}

const GENERIC_FAILURE: AgentEvent = {
  type: "error",
  message: "The agent could not finish this request. Try again.",
  retryable: true,
};

const isTerminal = (e: AgentEvent): boolean => (TERMINAL_EVENT_TYPES as readonly string[]).includes(e.type);

export async function* runAgent(request: AgentRequest, options: RunOptions): AsyncGenerator<AgentEvent> {
  const { signal, threadId } = options;
  let terminal = false;
  try {
    for await (const event of options.engine.run({ request, threadId }, signal)) {
      if (signal?.aborted || terminal) return;
      if (isTerminal(event)) terminal = true;
      yield event;
    }
  } catch (err) {
    if (signal?.aborted) return;
    options.log.error("agent-run-failed", {
      threadId,
      compositionId: request.compositionId,
      reason: err instanceof Error ? err.name : "unknown",
    });
    if (!terminal) yield GENERIC_FAILURE;
    return;
  }
  if (!terminal && !signal?.aborted) {
    options.log.error("agent-run-no-terminal", { threadId, compositionId: request.compositionId });
    yield GENERIC_FAILURE;
  }
}

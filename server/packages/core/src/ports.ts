// The only interfaces the core knows. Adapters implement these; the core
// never imports an adapter, a design system pack, a vendor SDK or SQL.
import type { ZodObject, ZodRawShape, ZodType } from "zod";
import type {
  AgentEvent,
  AgentRequest,
  CompositionDetail,
  CompositionSummary,
  PlacementView,
} from "@experience-agent/contract";

// Where a component may appear. "page" = a page template; "composition" = a
// composition; "both" = either.
export type AllowedIn = "composition" | "page" | "both";

export interface CatalogEntry {
  component: string;
  // "catalog" = in the design system's catalog; "extra" = registered by the pack.
  source: "catalog" | "extra";
  allowedIn: AllowedIn;
  // Props only. The validator adds the id/component/action/checks/weight keys
  // itself and rejects any prop the schema does not declare.
  props: ZodObject<ZodRawShape>;
}

export interface RuleSet {
  // DS-1xx rules still waiting for the design team's real list.
  readonly placeholderRules: readonly string[];
  // The approved Badge background tokens (cap colors).
  readonly capColors: readonly string[];
}

export interface CatalogSource {
  readonly catalogId: string;
  // undefined = not in the catalog and not registered as an extra.
  entry(component: string): CatalogEntry | undefined;
  rules(): RuleSet;
}

export interface GuidelineSource {
  // query: a question built from what the generator needs to know, never the user's words.
  // components: the components the question is about; empty means any.
  search(q: { query: string; components: string[] }): Promise<{ sourceId: string; text: string }[]>;
}

export interface CompositionCandidate {
  compositionId: string;
  name: string;
  family: string;
  description: string;
  type: string;
}

export interface CompositionStore {
  // list() may be cached by the adapter; the port makes no promise either way.
  list(filter?: { type?: string; q?: string }): Promise<CompositionSummary[]>;
  // null when the composition does not exist.
  get(compositionId: string): Promise<CompositionDetail | null>;
  placements(compositionId: string): Promise<PlacementView[]>;
  // Compositions whose family, name and description together contain every word of the text.
  search(text: string): Promise<CompositionCandidate[]>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelClient {
  structured<T>(args: {
    system: string;
    messages: ChatMessage[];
    schema: ZodType<T>;
    signal?: AbortSignal;
  }): Promise<T>;
}

// Structured logs for warnings and failures. Never receives keys or whole documents.
export interface Logger {
  warn(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

// One run per thread at a time. tryAcquire returns null when another run holds the
// thread; release() frees it. The adapter decides how (Postgres advisory lock today).
export interface ThreadLock {
  tryAcquire(threadId: string): Promise<{ release(): Promise<void> } | null>;
}

// The flow that answers one prompt. The LangGraph adapter implements it; the
// core only sees this port, so swapping the engine touches no node code.
export interface AgentEngine {
  run(input: { request: AgentRequest; threadId: string }, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

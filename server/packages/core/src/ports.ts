// The only interfaces the core knows. Adapters implement these; the core
// never imports an adapter, a design system pack, a vendor SDK or SQL.
import type { ZodObject, ZodRawShape, ZodType } from "zod";
import type {
  A2UIDocument,
  AgentEvent,
  AgentRequest,
  CompositionDetail,
  CompositionInput,
  CompositionRecord,
  CompositionSummary,
  CompositionVersionSummary,
  DeleteImpact,
  PageTemplateInput,
  PageTemplateRecord,
  PlacementInput,
  PlacementKey,
  PlacementRecord,
  PlacementView,
  SavedBy,
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
  // The composition types in use, read from the data rather than from a file:
  // a type authored in the Studio has to be one the agent knows about too.
  types(): Promise<string[]>;
}

// Writes for the Studio. Deliberately separate from CompositionStore: the read
// path is cached by a wrapper that forwards methods by hand (apps/service/src/cache.ts),
// so a method added to CompositionStore would be silently dropped. Nothing in the
// agent flow touches this port.
//
// Every upsert derives what it can from the document rather than trusting the
// caller (components used, a page's slots) and preserves the row's `origin`:
// an edit records no change of provenance.
export interface AuthoringStore {
  // Compositions
  listCompositions(): Promise<CompositionRecord[]>;
  upsertComposition(input: CompositionInput): Promise<CompositionRecord>;
  // false when no such composition exists, so a route can answer 404.
  deleteComposition(compositionId: string): Promise<boolean>;
  // What a hard delete would take with it, for the confirm dialog. null = no such row.
  compositionDeleteImpact(compositionId: string): Promise<DeleteImpact | null>;

  // Page templates
  listPageTemplates(): Promise<PageTemplateRecord[]>;
  upsertPageTemplate(input: PageTemplateInput): Promise<PageTemplateRecord>;
  deletePageTemplate(pageTemplateId: string): Promise<boolean>;
  pageTemplateDeleteImpact(pageTemplateId: string): Promise<DeleteImpact | null>;

  // Mappings. Page-centric, because a page's slots are what constrains them.
  placementsForPage(pageTemplateId: string): Promise<PlacementRecord[]>;
  setPlacement(input: PlacementInput): Promise<void>;
  deletePlacement(key: PlacementKey): Promise<void>;

  // History. Versions number from 1 per composition; appendVersion returns the
  // number it assigned. savedBy is required so each call site says which it is.
  listVersions(compositionId: string): Promise<CompositionVersionSummary[]>;
  appendVersion(input: {
    compositionId: string;
    a2ui: A2UIDocument;
    summary?: string;
    savedBy: SavedBy;
  }): Promise<number>;
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

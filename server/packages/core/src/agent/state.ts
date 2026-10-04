// The state the graph passes between nodes. The engine keeps `messages` per
// thread; every other field is reset at the start of each run (startRun).
import type { A2UIDocument, AgentRequest, CompositionDetail, CompositionSummary } from "@experience-agent/contract";
import type { CatalogEntry, ChatMessage, CompositionCandidate } from "../ports";
import type { ValidationError } from "../validator";

export type RouteKind = "edit" | "ask" | "scope" | "unsupported" | "switch";

export interface Route {
  kind: RouteKind;
  // Component names the request is about, e.g. ["Badge"].
  components: string[];
  // What about those components, e.g. "backgroundColor". Null when unclear.
  topic: string | null;
  // Plain sentence for scope and unsupported requests, shown to the user.
  message: string;
  // Questions for the guideline source, written for what the generator must know.
  guidelineQueries: string[];
  // For switch: the composition name the designer used, e.g. "Basic Plan Tile - Mobile".
  targetText: string | null;
}

export interface GatheredContext {
  catalog: CatalogEntry[];
  guidelines: { sourceId: string; text: string }[];
  variants: CompositionSummary[];
}

export interface Refusal {
  reason: string;
  alternatives: string[];
}

export interface AgentState {
  request: AgentRequest;
  // Short summaries only: the user's prompts and the assistant's one-line answers.
  messages: ChatMessage[];
  route: Route | null;
  context: GatheredContext | null;
  draft: A2UIDocument | null;
  draftSummary: string | null;
  draftMessage: string | null;
  refusal: Refusal | null;
  validationErrors: ValidationError[];
  repairAttempts: number;
  // Set by route: the open composition's stored record. Carried so generate can
  // use the prose people wrote about it (agentRules) without a second read.
  composition: CompositionDetail | null;
  // Set by find: the composition to open, or a plain reply when no single one was chosen.
  target: CompositionCandidate | null;
  reply: string | null;
}

// Values that belong to one run. The engine passes these as the input of
// every run, so nothing from the previous run leaks into this one.
export function startRun(request: AgentRequest): AgentState {
  return {
    request,
    messages: [],
    route: null,
    composition: null,
    context: null,
    draft: null,
    draftSummary: null,
    draftMessage: null,
    refusal: null,
    validationErrors: [],
    repairAttempts: 0,
    target: null,
    reply: null,
  };
}

// The state the graph passes between nodes. The engine keeps `messages` per
// thread; every other field is reset at the start of each run (startRun).
import type { A2UIDocument, AgentRequest, CompositionSummary } from "@experience-agent/contract";
import type { CatalogEntry, ChatMessage } from "../ports";
import type { ValidationError } from "../validator";

export type RouteKind = "edit" | "ask" | "scope" | "unsupported";

export interface Route {
  kind: RouteKind;
  // Component names the request is about, e.g. ["Badge"].
  components: string[];
  // What about those components, e.g. "backgroundColor". Null when unclear.
  topic: string | null;
  // Plain sentence for scope and unsupported requests, shown to the user.
  message: string;
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
}

// Values that belong to one run. The engine passes these as the input of
// every run, so nothing from the previous run leaks into this one.
export function startRun(request: AgentRequest): AgentState {
  return {
    request,
    messages: [],
    route: null,
    context: null,
    draft: null,
    draftSummary: null,
    draftMessage: null,
    refusal: null,
    validationErrors: [],
    repairAttempts: 0,
  };
}

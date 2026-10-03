// The six nodes as plain functions. Each reads the run state and returns the
// part of the state it changes. Model calls happen only in route, generate and
// repair; gather, validate and respond are code. Nothing here knows about
// LangGraph: the graph adapter wraps these functions.
import { z } from "zod";
import type { A2UIDocument, AgentEvent } from "@experience-agent/contract";
import { A2UIDocumentSchema } from "@experience-agent/contract";
import { LABELS, type StepId } from "../graph/labels";
import type { CatalogEntry, CatalogSource, ChatMessage, CompositionStore, GuidelineSource, Logger, ModelClient } from "../ports";
import { blocking, validate as validateDocument, warnings } from "../validator";
import { GenerateSchema, RouteSchema } from "./schemas";
import type { AgentState, GatheredContext } from "./state";

export interface PackPrompts {
  systemPrompt: string;
  compositionTypes: string[];
}

export interface AgentDeps {
  model: ModelClient;
  catalog: CatalogSource;
  guidelines: GuidelineSource;
  compositions: CompositionStore;
  pack: PackPrompts;
  log: Logger;
}

export type Emit = (event: AgentEvent) => void;
export type NodeFn = (state: AgentState, emit: Emit) => Promise<Partial<AgentState>>;

export interface Nodes {
  route: NodeFn;
  gather: NodeFn;
  generate: NodeFn;
  validate: NodeFn;
  repair: NodeFn;
  respond: NodeFn;
}

// Component names in a document, from its updateComponents messages.
export function documentComponents(doc: A2UIDocument): string[] {
  const names = new Set<string>();
  for (const msg of doc.a2ui) {
    if ("updateComponents" in msg) for (const c of msg.updateComponents.components) names.add(c.component);
  }
  return [...names];
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} is missing from the run state`);
  return value;
}

// Wraps a node so the chat sees "running" when it starts and "done" when it finishes.
function withStatus(stepId: StepId, fn: NodeFn): NodeFn {
  return async (state, emit) => {
    emit({ type: "status", stepId, label: LABELS[stepId], state: "running" });
    const update = await fn(state, emit);
    emit({ type: "status", stepId, label: LABELS[stepId], state: "done" });
    return update;
  };
}

export function makeNodes(deps: AgentDeps): Nodes {
  const system = deps.pack.systemPrompt;

  const route: NodeFn = async (state) => {
    const { request } = state;
    const composition = await deps.compositions.get(request.compositionId);
    if (!composition) {
      return {
        route: { kind: "unsupported", components: [], topic: null, message: "That composition isn't available in this workspace." },
      };
    }
    const instructions = [
      `Composition: ${composition.name} (id ${composition.compositionId}, type ${composition.type}).`,
      `Known composition types: ${deps.pack.compositionTypes.join(", ")}.`,
      `Components in it: ${documentComponents(request.currentA2ui).join(", ") || "(none)"}.`,
      `Request: ${request.prompt}`,
      "Classify the request. edit: change this composition. ask: a question about it or its variants. scope: about a different composition or page. unsupported: not a design change to this composition.",
      "Name the components the request is about and the topic (for example backgroundColor). Give a plain sentence in message for scope and unsupported.",
    ].join("\n");
    const out = await deps.model.structured({
      system,
      messages: [...state.messages, { role: "user", content: instructions }],
      schema: RouteSchema,
    });
    return { route: out };
  };

  const gather: NodeFn = async (state) => {
    const r = required(state.route, "route");
    const names = unique([...r.components, ...documentComponents(state.request.currentA2ui)]);
    const catalog = names.flatMap((name): CatalogEntry[] => {
      const entry = deps.catalog.entry(name);
      return entry ? [entry] : [];
    });

    // Guidelines are for edits only; a question about variants needs no usage rules.
    const guidelines: GatheredContext["guidelines"] = [];
    if (r.kind === "edit") {
      const seen = new Set<string>();
      for (const component of r.components) {
        const hits = await deps.guidelines.search({ component, ...(r.topic ? { topic: r.topic } : {}) });
        for (const hit of hits) {
          if (seen.has(hit.sourceId)) continue;
          seen.add(hit.sourceId);
          guidelines.push(hit);
        }
      }
    }

    let variants: GatheredContext["variants"] = [];
    if (r.kind === "ask") {
      const composition = await deps.compositions.get(state.request.compositionId);
      if (composition) variants = await deps.compositions.list({ type: composition.type });
    }

    return { context: { catalog, guidelines, variants } };
  };

  const generate: NodeFn = async (state) => {
    const ctx = required(state.context, "context");
    const components = ctx.catalog.map((e) => ({ component: e.component, props: z.toJSONSchema(e.props) }));
    const instructions = [
      `Request: ${state.request.prompt}`,
      "Current A2UI document. Return the full new document when you edit it:",
      JSON.stringify(state.request.currentA2ui),
      "Catalog for the components involved (JSON Schema for each):",
      JSON.stringify(components),
      "Guidelines (cite the sourceId in a refusal):",
      ctx.guidelines.map((g) => `[${g.sourceId}] ${g.text}`).join("\n") || "(none)",
      'Return kind "edit" with the full document, a short summary and one friendly message sentence. Or return kind "refusal" with a reason and alternatives that the catalog and the guidelines both allow.',
    ].join("\n\n");
    const out = await deps.model.structured({
      system,
      messages: [...state.messages, { role: "user", content: instructions }],
      schema: GenerateSchema,
    });

    if (out.kind === "refusal") {
      return { refusal: { reason: out.reason ?? "That change isn't allowed.", alternatives: out.alternatives } };
    }
    if (!out.a2ui) throw new Error("generate returned an edit without a document");
    return {
      draft: out.a2ui,
      draftSummary: out.summary ?? "Changed the composition",
      draftMessage: out.message ?? out.summary ?? "Done.",
    };
  };

  // Checks the draft in code. Errors block; warnings go to the log only.
  const validate: NodeFn = async (state) => {
    const findings = validateDocument(state.draft, {
      kind: "composition",
      catalog: deps.catalog,
      current: state.request.currentA2ui,
    });
    for (const w of warnings(findings)) {
      deps.log.warn("validation-warning", {
        code: w.code,
        path: w.path,
        componentId: w.componentId,
        compositionId: state.request.compositionId,
      });
    }
    return { validationErrors: blocking(findings) };
  };

  const repair: NodeFn = async (state) => {
    const instructions = [
      "The draft below fails validation. Return the corrected full document and change nothing else.",
      "Errors:",
      state.validationErrors
        .map((e) => `- ${e.code} at ${e.path}: ${e.message}${e.hint ? ` (${e.hint})` : ""}`)
        .join("\n"),
      "Draft:",
      JSON.stringify(state.draft),
    ].join("\n");
    const fixed = await deps.model.structured({
      system,
      messages: [...state.messages, { role: "user", content: instructions }],
      schema: A2UIDocumentSchema,
    });
    return { draft: fixed, repairAttempts: state.repairAttempts + 1 };
  };

  // Sends exactly one terminal event and appends a short summary to the thread.
  const respond: NodeFn = async (state, emit) => {
    const { request, route: r, refusal, draft, validationErrors } = state;
    let memory: string;

    if (refusal) {
      emit({ type: "refusal", reason: refusal.reason, alternatives: refusal.alternatives });
      memory = `Refused: ${refusal.reason}`;
    } else if (!r) {
      emit({ type: "error", message: "The request could not be classified.", retryable: true });
      memory = "Error: the request could not be classified.";
    } else if (r.kind === "scope") {
      emit({ type: "scope", message: r.message });
      memory = r.message;
    } else if (r.kind === "unsupported") {
      emit({ type: "refusal", reason: r.message, alternatives: [] });
      memory = r.message;
    } else if (r.kind === "ask") {
      // Answers come in B3; until then a question gets a plain, non-retryable error.
      emit({ type: "error", message: "Questions about compositions aren't answered yet.", retryable: false });
      memory = "Question not answered yet.";
    } else if (draft && validationErrors.length === 0) {
      const summary = state.draftSummary ?? "Changed the composition";
      emit({
        type: "result",
        a2ui: draft,
        summary,
        message: state.draftMessage ?? summary,
      });
      memory = summary;
    } else {
      emit({
        type: "error",
        message: "I couldn't make that change in a valid form. Try rephrasing the request.",
        retryable: true,
      });
      memory = "Error: the change did not pass validation.";
    }

    const messages: ChatMessage[] = [
      { role: "user", content: request.prompt },
      { role: "assistant", content: memory },
    ];
    return { messages };
  };

  return {
    route: withStatus("route", route),
    gather: withStatus("gather", gather),
    generate: withStatus("generate", generate),
    validate: withStatus("validate", validate),
    repair: withStatus("repair", repair),
    respond,
  };
}

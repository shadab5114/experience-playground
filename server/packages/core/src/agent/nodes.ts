// The six nodes as plain functions. Each reads the run state and returns the
// part of the state it changes. Model calls happen only in route, generate and
// repair; gather, validate and respond are code. Nothing here knows about
// LangGraph: the graph adapter wraps these functions.
import { z } from "zod";
import type { A2UIDocument, AgentEvent, AgentRequest } from "@experience-agent/contract";
import { documentComponents } from "../document";
import { LABELS, type StepId } from "../graph/labels";
import type { CatalogEntry, CatalogSource, ChatMessage, CompositionStore, GuidelineSource, Logger, ModelClient } from "../ports";
import { blocking, validate as validateDocument, warnings } from "../validator";
import { GenerateSchema, ModelDocumentSchema, PickSchema, RouteSchema } from "./schemas";
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
  find: NodeFn;
  gather: NodeFn;
  generate: NodeFn;
  validate: NodeFn;
  repair: NodeFn;
  respond: NodeFn;
}

// The open composition, for the nodes that work on it. Only edit and question routes get
// here, and the route node sends everything else away when no composition is open.
function openComposition(request: AgentRequest): { compositionId: string; currentA2ui: A2UIDocument } {
  if (request.compositionId === undefined || request.currentA2ui === undefined) {
    throw new Error("no composition is open for this request");
  }
  return { compositionId: request.compositionId, currentA2ui: request.currentA2ui };
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

// Filler words a designer uses around a composition name ("show me the home plan").
const FILLER = new Set(["show", "me", "bring", "open", "the", "a", "an", "to", "please", "switch", "go", "back", "on", "of", "up", "can", "you", "i", "want", "see", "view"]);

export function targetWordsFromPrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "" && !FILLER.has(w))
    .join(" ");
}

// Used only when the route wrote no questions of its own.
export function fallbackGuidelineQuery(components: string[], topic: string | null): string {
  const subject = components.length > 0 ? components.join(" and ") : "this component";
  return `What is allowed for ${subject}${topic ? ` (${topic})` : ""} on a plan tile?`;
}

export function makeNodes(deps: AgentDeps): Nodes {
  const system = deps.pack.systemPrompt;

  // The types in use, plus the pack's own list so a database with no
  // compositions yet still names something. A lookup failure costs the hint,
  // not the run: the pack's list stands in.
  const compositionTypes = async (): Promise<string[]> => {
    const stored = await deps.compositions.types().catch((err: unknown) => {
      deps.log.warn("composition-types-unavailable", { reason: err instanceof Error ? err.name : "unknown" });
      return [] as string[];
    });
    return unique([...deps.pack.compositionTypes, ...stored]).sort();
  };

  const route: NodeFn = async (state) => {
    const { request } = state;
    // The pack's list seeds an empty database; the data is what the agent is
    // actually told about, so a type authored in the Studio is not invisible here.
    const knownTypes = await compositionTypes();
    if (request.compositionId === undefined || request.currentA2ui === undefined) {
      // Chat-first: nothing is open yet. Only a request to open a composition makes sense here.
      const out = await deps.model.structured({
        system,
        messages: [
          ...state.messages,
          {
            role: "user",
            content: [
              "No composition is open yet. The designer types a request before choosing a tile.",
              `Known composition types: ${knownTypes.join(", ")}.`,
              `Request: ${request.prompt}`,
              "Classify it. switch: asks to open or bring up a composition or variant by name, such as \"show me home plan\"; put only the designer's own words for it in targetText. unsupported: anything else.",
            ].join("\n"),
          },
        ],
        schema: RouteSchema,
      });
      if (out.kind === "switch") return { route: out };
      return {
        route: {
          kind: "unsupported",
          components: [],
          topic: null,
          message: 'Tell me which composition to open first, for example "show me home plan".',
          guidelineQueries: [],
          targetText: null,
        },
      };
    }

    // Fetched here and carried on the state: generate needs the prose written
    // about this composition, and route has already paid for the read.
    const composition = await deps.compositions.get(request.compositionId);
    if (!composition) {
      return {
        route: {
          kind: "unsupported",
          components: [],
          topic: null,
          message: "That composition isn't available in this workspace.",
          guidelineQueries: [],
          targetText: null,
        },
      };
    }
    const instructions = [
      `Composition: ${composition.name} (id ${composition.compositionId}, type ${composition.type}).`,
      `Known composition types: ${knownTypes.join(", ")}.`,
      `Components in it: ${documentComponents(request.currentA2ui).join(", ") || "(none)"}.`,
      `Request: ${request.prompt}`,
      "Classify the request. edit: a request to change this composition, even when it is phrased as a statement such as \"change X to Y\". ask: only a question, such as one with \"what\", \"which\", \"how\" or a question mark, about this composition or its variants. switch: asks to open or bring up a different composition or variant by name, such as \"bring me Basic Plan Tile - Mobile\"; put in targetText only the words the designer used for it, with no word added (for \"show me home plan\", targetText is \"home plan\"). scope: about a page or a part of a page, such as the PDP header. unsupported: not a design change to this composition.",
      "Name the components the request is about and the topic (for example backgroundColor). Give a plain sentence in message for scope and unsupported.",
      "For an edit, write guidelineQueries: one to three questions the generator must have answered before making this change. Each names the component, the property and the value asked for, and asks what is allowed. Example for 'change cap color or badge to red': 'Which background colors are approved for a Badge on a plan tile, and is red one of them?'. Write questions, never the request's own words.",
    ].join("\n");
    const out = await deps.model.structured({
      system,
      messages: [...state.messages, { role: "user", content: instructions }],
      schema: RouteSchema,
    });
    return { route: out, composition };
  };

  // Finds the composition a switch request names. One match is taken as is; several go
  // to the model, which may pick only from those matches.
  const find: NodeFn = async (state) => {
    const r = required(state.route, "route");
    const text = (r.targetText ?? "").trim();
    if (text === "") return { target: null, reply: "Which composition would you like to open?" };

    // The name the route extracted first. If it matches nothing, the designer's own
    // words from the prompt (without filler such as "show me") are the second try.
    let matches = await deps.compositions.search(text);
    if (matches.length === 0) {
      const fromPrompt = targetWordsFromPrompt(state.request.prompt);
      if (fromPrompt !== "" && fromPrompt !== text) matches = await deps.compositions.search(fromPrompt);
    }
    if (matches.length === 0) {
      return { target: null, reply: `I couldn't find a composition called "${text}" in this design system.` };
    }
    if (matches.length === 1) return { target: matches[0] ?? null };

    const pick = await deps.model.structured({
      system,
      messages: [
        ...state.messages,
        {
          role: "user",
          content: [
            `Request: ${state.request.prompt}`,
            "Several compositions match. Choose the one the designer means, using only these ids:",
            ...matches.map((m) => `- ${m.compositionId}: ${m.name} (family ${m.family}). ${m.description}`),
            "Return compositionId as one of these ids, or null with a short question in message if none is clearly right.",
          ].join("\n"),
        },
      ],
      schema: PickSchema,
    });
    const chosen = matches.find((m) => m.compositionId === pick.compositionId);
    return chosen ? { target: chosen } : { target: null, reply: pick.message };
  };

  const gather: NodeFn = async (state) => {
    const r = required(state.route, "route");
    const names = unique([...r.components, ...documentComponents(openComposition(state.request).currentA2ui)]);
    const catalog = names.flatMap((name): CatalogEntry[] => {
      const entry = deps.catalog.entry(name);
      return entry ? [entry] : [];
    });

    // Guidelines are for edits only; a question about variants needs no usage rules.
    const guidelines: GatheredContext["guidelines"] = [];
    if (r.kind === "edit") {
      const seen = new Set<string>();
      // The route's questions are what gather asks. The generic question is only a fallback.
      const queries = r.guidelineQueries.length > 0 ? r.guidelineQueries : [fallbackGuidelineQuery(r.components, r.topic)];
      for (const [index, query] of queries.entries()) {
        // A failed lookup costs the advice, not the run: the validator still enforces the must-never rules.
        let hits: { sourceId: string; text: string }[];
        try {
          hits = await deps.guidelines.search({ query, components: r.components });
        } catch (err) {
          deps.log.warn("guidelines-unavailable", {
            query: index,
            compositionId: state.request.compositionId,
            reason: err instanceof Error ? err.name : "unknown",
          });
          hits = [];
        }
        for (const hit of hits) {
          if (seen.has(hit.sourceId)) continue;
          seen.add(hit.sourceId);
          guidelines.push(hit);
        }
      }
    }

    let variants: GatheredContext["variants"] = [];
    if (r.kind === "ask") {
      const composition = await deps.compositions.get(openComposition(state.request).compositionId);
      if (composition) variants = await deps.compositions.list({ type: composition.type });
    }

    return { context: { catalog, guidelines, variants } };
  };

  const generate: NodeFn = async (state) => {
    const ctx = required(state.context, "context");
    const rules = state.composition?.agentRules?.trim();
    const components = ctx.catalog.map((e) => ({ component: e.component, props: z.toJSONSchema(e.props) }));
    const instructions = [
      `Request: ${state.request.prompt}`,
      "Current A2UI document. Return the full new document when you edit it:",
      JSON.stringify(openComposition(state.request).currentA2ui),
      "Catalog for the components involved (JSON Schema for each):",
      JSON.stringify(components),
      "Guidelines (cite the sourceId in a refusal):",
      ctx.guidelines.map((g) => `[${g.sourceId}] ${g.text}`).join("\n") || "(none)",
      // Most specific last: the pack's system prompt, then the retrieved
      // guidelines, then the rules written about this one composition. These
      // steer the model and are not enforced afterwards — a rule is guidance,
      // which is why it lives in the prompt and not in the validator.
      ...(rules
        ? [`Rules for this composition, written by its author. Follow them unless a guideline forbids it:\n${rules}`]
        : []),
      // Spelled out because the envelope's own message list is called "a2ui"
      // too, and a model told to put a document in a field named "a2ui" will
      // otherwise return the bare message array.
      'Return kind "edit" with the full document, a short summary and one friendly message sentence. The a2ui field is the whole document object, shaped { "meta": {...}, "a2ui": [ ...messages... ] } like the one above — not the bare message array. Or return kind "refusal" with a reason and alternatives that the catalog and the guidelines both allow.',
    ].join("\n\n");
    const out = await deps.model.structured({
      system,
      messages: [...state.messages, { role: "user", content: instructions }],
      schema: GenerateSchema,
    });

    if (out.kind === "refusal") {
      return {
        refusal: { reason: out.reason ?? "That change isn't allowed.", alternatives: out.alternatives ?? [] },
      };
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
      current: openComposition(state.request).currentA2ui,
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
      schema: ModelDocumentSchema,
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
    } else if (r.kind === "switch") {
      if (state.target && state.target.compositionId !== request.compositionId) {
        const message = `Opening ${state.target.name}. Unsaved work in this task will be discarded.`;
        emit({ type: "switch", compositionId: state.target.compositionId, name: state.target.name, message });
        memory = `Switched to ${state.target.name}.`;
      } else if (state.target) {
        const text = `${state.target.name} is already open.`;
        emit({ type: "answer", text });
        memory = text;
      } else {
        const text = state.reply ?? "I couldn't find that composition.";
        emit({ type: "answer", text });
        memory = text;
      }
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
    find: withStatus("find", find),
    gather: withStatus("gather", gather),
    generate: withStatus("generate", generate),
    validate: withStatus("validate", validate),
    repair: withStatus("repair", repair),
    respond,
  };
}

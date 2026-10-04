# Experience Agent — Backend Foundation Plan

Oct 3, 2026 · @Shadab

## Overview

Backend v1 is one small service that replaces the playground's mock agent: it takes a prompt and the current A2UI, runs a fixed LangGraph flow, and streams back the same events the UI already understands.

Think of it as a kitchen with one fixed recipe card. Every order goes through the same stations in the same order: read the order, cook, taste-test against the house rules, fix if needed, serve. No station is optional, and you can see which station the order is at any moment.

### Principles

- **Full control.** Every step is an explicit node in a LangGraph graph. The model works inside a node; it never decides which nodes run.
- **Simple first.** Start with the smallest set of building blocks that makes the playground work end to end. Add queues and extra services only when a real need appears.
- **Portable core.** The agent core knows nothing about VDS, Postgres, the RAG endpoint or the model vendor. Each of those plugs in through a small interface, so the core moves to another system or design system unchanged.
- **Two front doors, one agent.** The playground calls over HTTP and SSE; other agents hand off over A2A. Both run the same graph.
- **One database.** Postgres holds compositions, mappings, saved versions and thread memory.
- **The contract is the spec.** The backend implements the `AgentRequest` and `AgentEvent` shapes exactly, from a shared package.
- **Validation is never skipped.** Nothing reaches a caller unless it passes the validator.
- **Reuse what already works.** The catalog compiler, validator and Postgres checkpointer setup from the existing LangGraph + A2UI backend are carried over, not rebuilt.

### In scope for the foundation

- Composition reads: list, search, load and placements from Postgres, with no model call
- One streaming endpoint for prompts, plus thread cleanup and health
- The agent graph: route, gather context, generate, validate, repair, respond
- Three grounding sources: VDS catalog (local JSON), usage guidelines (RAG endpoint), compositions (Postgres)
- One Postgres database for compositions, page templates, mappings and thread memory
- A portable core with swappable adapters, and VDS packaged as one design system pack
- An A2A entry point so other agents can hand off experience work
- Anthropic API with a configurable base URL and key, so the org gateway works by config
- Tracing and a golden test set built from the playground's demo scenarios

### Not in the foundation

- Saving edited compositions on the server (the `composition_versions` table is ready; the UI keeps saves in `localStorage` for now)
- Job queues and multi-agent orchestration inside the service
- Authentication beyond a shared key for the playground and bearer tokens for A2A callers
- Impact analysis by the agent

## Building blocks at a glance

One service, two front doors, one database, one model. Picking a template reads Postgres directly; prompts from the playground or from other agents run the agent graph, which is the only part that talks to the model.

&#91;embedded content: building blocks · two doors, one graph, one database\]

Read it top down. A template pick takes the fast path on the left: API layer to Postgres and back, no model. A prompt from the playground enters through the API layer; a handoff from another agent enters through the A2A door. Both run the same graph, which reads the local VDS catalog for component facts, the RAG endpoint for usage guidelines, and Postgres for compositions, variants and thread memory, then calls the model for the creative step. The shared contract package keeps the playground and the service in step.

## Portable core

Four layers. Only the bottom layer knows about VDS, your RAG endpoint, Postgres or Anthropic, so moving to another system or design system means writing adapters, not touching the agent.

Think of a travel adapter: the laptop stays the same in every country; only the plug changes.

&#91;embedded content: portable core · doors, core, ports, adapters\]

### Ports

Each port is a small TypeScript interface. The core imports only these, never an adapter.

```ts
interface CatalogSource {
  getEntries(types?: string[]): Promise<CatalogEntry[]>;
  schemaFor(type: string): ZodType;           // compiled from the pack's catalog
  rules(): RuleSet;                            // must-never rules
}

interface GuidelineSource {
  search(q: { component: string; topic?: string }): Promise<{ sourceId: string; text: string }[]>;
}

interface CompositionStore {
  list(filter?: { type?: string; q?: string }): Promise<CompositionSummary[]>;
  get(compositionId: string): Promise<CompositionDetail>;
  placements(compositionId: string): Promise<PlacementView[]>;
}

interface ModelClient {
  structured<T>(args: { system: string; messages: ChatMessage[]; schema: ZodType<T>; signal?: AbortSignal }): Promise<T>;
}

// Thread memory uses LangGraph's own checkpointer interface, backed by Postgres.
// It is imported only by adapters/langgraph; the core never sees it.

interface AgentEngine {
  // The flow that answers one prompt. adapters/langgraph implements it.
  run(input: { request: AgentRequest; threadId: string }, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

interface ThreadLock {
  // Null when another run already holds this thread. The lock is released by calling release().
  tryAcquire(threadId: string): Promise<{ release(): Promise<void> } | null>;
}
```

Where the graph lives: LangGraph is not imported by `packages/core`. The core holds the node functions, routing, state and the `AgentEngine` port. `adapters/langgraph` builds the `StateGraph`, attaches the Postgres checkpointer and implements `AgentEngine`. The core's import rule test enforces this.

The validator follows the same split: the engine (envelope, structure and scope checks, plus the code that runs catalog and rule checks) lives in the core; the catalog and rules it checks against come from the pack.

### Design system pack

Everything specific to one design system lives in one folder, chosen at startup with `DS_PACK=vds`:

```text
ds-packs/vds/
  pack.json          # name, pinned A2UI version, guideline and store settings
  catalog.json       # component catalog, compiled to Zod at startup
  rules.json         # must-never rules
  prompts/system.md  # design-system wording for the model (names, tone, conventions)
  golden/            # test scenarios for this design system
```

### Switching to another design system

1. Create a new pack with its catalog, rules and prompt wording.
2. Point the guideline and composition adapters at its RAG endpoint and store (config only).
3. In the UI, update the A2UI renderer's registry so the new catalog's component types map to the new React components. This is the one real piece of work outside the backend.
4. Run the pack's golden scenarios.

The graph, nodes, validator engine and both front doors stay as they are.

### Model configuration

The only model adapter is Anthropic. Both the URL and the key come from config, so pointing at your org's gateway is an env change:

```bash
ANTHROPIC_BASE_URL=https://api.anthropic.com   # or your org's API URL
ANTHROPIC_API_KEY=<your org key>
MODEL_ID=<model id your org enables>
MODEL_TIMEOUT_MS=60000
```

The adapter passes the base URL and key to the client explicitly rather than relying on defaults, and never logs the key.

## A2A entry point

Other agents, such as the marketing orchestrator or an app agent, hand off experience work over A2A. A thin adapter turns their message into the same `AgentRequest`, runs the same graph, and turns the `AgentEvent`s back into A2A updates. It is a second door into the same kitchen, using the same recipe card.

### Discovery

The agent card is served publicly at `/.well-known/agent-card.json`. It names the agent, says it supports streaming, declares bearer-token auth, and lists two skills:

| Skill | What a caller asks | What it gets back |
| --- | --- | --- |
| `edit-experience` | Change a composition, by id or with its A2UI attached | The new A2UI as an artifact plus a summary, or a refusal with alternatives |
| `find-variants` | Which compositions or variants exist for a type | A short answer plus references |

### Handoff message

The caller sends `message/send` or `message/stream` with a text part (the instruction) and a data part:

```json
{
  "compositionId": "basic-plan-tile",
  "experienceId": "basic-plan-mobile",
  "a2ui": { "...": "optional; if missing, the adapter loads it from Postgres" }
}
```

The A2A `contextId` becomes the `threadId`, so follow-ups in the same context share conversation memory, just like a playground task.

### Mapping outcomes to A2A

| Graph event | A2A task state | What the caller receives |
| --- | --- | --- |
| `status` | working | A status update with the label, when streaming |
| `result` | completed | An artifact holding the A2UI document, plus the summary as text |
| `answer` | completed | The answer text plus references as data |
| `refusal` | input-required | The reason and alternatives; the caller replies in the same context to pick one |
| `scope` | rejected | A message saying what is out of scope |
| `error` | failed | The error message |

A2UI travels as a data part following the A2UI extension for A2A, so any A2UI-aware caller can render it directly.

### Implementation

```ts
// sketch: the A2A door is only translation, no agent logic
class ExperienceExecutor implements AgentExecutor {
  async execute(ctx: RequestContext, bus: ExecutionEventBus) {
    const req = await fromHandoff(ctx.userMessage, compositionStore); // A2A message -> AgentRequest
    for await (const ev of runAgent(req, { threadId: ctx.contextId, signal: ctx.signal })) {
      bus.publish(toA2AUpdate(ev, ctx));                                // AgentEvent -> A2A update
    }
    bus.finished();
  }
}
```

- Use the official A2A JavaScript SDK (`@a2a-js/sdk`) for the protocol layer. If its server integration doesn't fit Hono, run the A2A door as its own small process that imports the same core.
- `runAgent` is the one function both doors call. Neither door contains agent logic.
- Each calling agent gets its own bearer token; the agent card stays public.

## API contract

Six endpoints. Three read from Postgres and never touch the model. The prompt endpoint streams server-sent events (SSE): a one-way stream from server to browser, like a live ticker the UI reads line by line.

| Method | Path | Purpose | Model? |
| --- | --- | --- | --- |
| GET | `/v1/compositions` | List and search compositions for the picker | No |
| GET | `/v1/compositions/:compositionId` | Load one composition's A2UI to start a task | No |
| GET | `/v1/compositions/:compositionId/placements` | Pages and slots where it appears, for View Impacts | No |
| POST | `/v1/threads/:threadId/prompts` | Run one prompt; responds with an SSE stream of `AgentEvent`s | Yes |
| DELETE | `/v1/threads/:threadId` | Close the task; deletes the thread's conversation memory | No |
| GET | `/health` | Liveness check, including the database connection | No |

The thread id is the playground's task id. One thread equals one task, from pick to close.

### Compositions (no model)

Picking a template and opening View Impacts are plain reads: Postgres in, JSON out. They should feel instant, so aim for under 200 ms and keep the picker list cached in memory for a short time.

```ts
// GET /v1/compositions?type=plan-tile&q=basic
interface CompositionSummary {
  compositionId: string;   // "basic-plan-tile"
  name: string;            // "Basic Plan – Mobile"
  type: string;            // "plan-tile"
  tags: string[];
}

// GET /v1/compositions/:compositionId
interface CompositionDetail extends CompositionSummary {
  a2ui: A2UIDocument;
}

// GET /v1/compositions/:compositionId/placements  (tab order)
interface PlacementView {
  flowId: string;          // "pdp" (the impacts tab key)
  flowName: string;        // "PDP"
  pageTemplateId: string;  // "pdp-mock"
  pageName: string;
  slotId: string;
  variant?: string;
  pageA2ui: A2UIDocument;  // the mock page; the UI places the composition in the slot
}
```

### Request

```ts
// POST /v1/threads/:threadId/prompts
interface AgentRequest {
  experienceId: string;
  compositionId: string;      // the lock: the agent may change only this
  currentA2ui: A2UIDocument;  // what the user sees right now (source of truth)
  prompt: string;
}
```

### Response events (SSE)

Each SSE message is `event: <type>` plus `data: <json>`, using the exact types from the playground plan:

```ts
type AgentEvent =
  | { type: "status"; stepId: string; label: string; state: "running" | "done" }
  | { type: "result"; a2ui: A2UIDocument; summary: string; message: string }
  | { type: "answer"; text: string; references?: { compositionId: string; name: string }[] }
  | { type: "refusal"; reason: string; alternatives: string[] }
  | { type: "scope"; message: string }
  | { type: "error"; message: string; retryable: boolean };
```

Every stream ends with exactly one of `result`, `answer`, `refusal`, `scope` or `error`, then closes. `answer` is new compared with the playground plan: it replies to questions such as "what plan tile variants exist?" without creating a version.

### Rules

- Request bodies are validated with Zod. A bad request returns HTTP 400 before any stream starts.
- One prompt per thread at a time. A second prompt while one is running returns HTTP 409.
- If the browser disconnects, the run is cancelled (AbortSignal) and nothing is written to the thread.
- A `result` always carries the whole new A2UI document, never a patch.

## The agent graph

Six nodes, fixed edges, one repair loop. The model works inside route, generate and repair; gather, validate and respond are plain code, so code decides what context is fetched and what ships.

&#91;embedded content: agent graph · 6 nodes, 1 repair loop\]

Every path ends at respond, which sends exactly one final event. Edits and questions both pass through gather; a question then goes straight to respond as an `answer`, with no new version. A request outside the locked composition never reaches gather, and a draft that fails validation twice becomes an error, not a broken tile.

### What each node does

| Node | Kind | Input | Output |
| --- | --- | --- | --- |
| `route` | Model (structured output) | Prompt, composition name, recent messages | `edit`, `ask`, `scope` or `unsupported`, plus the components and topic involved |
| `gather` | Code | Route output | Catalog entries, guideline passages, and variants when needed |
| `generate` | Model (structured output) | Current A2UI, prompt, gathered context | New A2UI + summary, or a refusal with alternatives |
| `validate` | Code | Draft A2UI | List of `ValidationError`s (empty means pass) |
| `repair` | Model (structured output) | Draft A2UI + errors | Corrected A2UI |
| `respond` | Code | Final state | One `result`, `answer`, `refusal`, `scope` or `error` event; appends a short summary to messages |

### Wiring

The node functions and routing live in `packages/core/src/agent/`. The graph is assembled in `adapters/langgraph`:

```ts
// adapters/langgraph/src/index.ts
const graph = new StateGraph(GraphState)
  .addNode("classify", nodes.route)   // named "classify": a node cannot share a state channel's name ("route")
  .addNode("gather", nodes.gather)
  .addNode("generate", nodes.generate)
  .addNode("validate", nodes.validate)
  .addNode("repair", nodes.repair)
  .addNode("respond", nodes.respond)
  .addEdge(START, "classify")
  .addConditionalEdges("classify", afterRoute)     // core/src/agent/routing.ts
  .addConditionalEdges("gather", afterGather)
  .addConditionalEdges("generate", afterGenerate)
  .addConditionalEdges("validate", afterValidate)  // repair at most MAX_REPAIR_ATTEMPTS (2) times
  .addEdge("repair", "validate")
  .addEdge("respond", END);
```

Status events keep the step ids from the core (`route`, not `classify`), so the chat labels don't change. The routing functions are plain code, so each branch is unit-tested without a model.

## State and persistence

The UI owns versions, undo and saves. The backend only remembers the conversation, so follow-ups like "make it a bit bigger again" make sense.

A useful picture: the UI hands the agent the current drawing every time, plus the request. The agent's memory is the notebook of what was asked before, not the drawing itself. If the user undoes on the client, the drawing they send wins.

### Graph state

```ts
const AgentState = Annotation.Root({
  // Input, set fresh on every run
  request: Annotation<AgentRequest>(),

  // Conversation memory, kept per thread by the checkpointer
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),

  // Working values for this run only
  route: Annotation<"edit" | "ask" | "scope" | "unsupported" | null>(),
  components: Annotation<string[]>(),          // e.g. ["TileContainer"]
  topic: Annotation<string | null>(),          // e.g. "background"
  context: Annotation<GatheredContext | null>(),
  draft: Annotation<A2UIDocument | null>(),
  draftSummary: Annotation<string | null>(),
  refusal: Annotation<{ reason: string; alternatives: string[] } | null>(),
  validationErrors: Annotation<ValidationError[]>(),
  repairAttempts: Annotation<number>(),
});
```

### What is persisted

| Data | Where | Lifetime |
| --- | --- | --- |
| Conversation messages (prompts and short summaries of results) | Postgres, through the LangGraph checkpointer, keyed by `threadId` | Until the task closes, or 24 hours idle |
| Compositions, page templates, flows, placements | Postgres tables (see Data model) | Permanent; seeded from the design system pack |
| Work-in-progress A2UI during a task | Not stored by the backend | The UI sends the current one each time |
| Versions and saves | UI `localStorage` for now; the `composition_versions` table is ready for server saves later | As defined in the playground plan |

Only short summaries of results go into messages, not whole A2UI documents. That keeps the conversation small and cheap to send to the model.

### Checkpointer

- Postgres is set up in B0 for compositions, so the graph uses the Postgres checkpointer from its first run in B2. There is no in-memory stage to migrate away from.
- The checkpointer is `@langchain/langgraph-checkpoint-postgres`, created in `adapters/langgraph`. Its setup call creates its own tables (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations`).
- One run per thread at a time. `ThreadLock` is a Postgres advisory lock: `pg_try_advisory_lock` on a hash of the thread id, held on a connection checked out for the whole run and released in `finally`. A second prompt on a busy thread gets 409. The lock uses its own small pool (`RUN_LOCK_POOL_SIZE`), so long runs cannot starve the composition reads. Different threads run in parallel.
- B4 adds the thread lifecycle: `DELETE /v1/threads/:threadId` and a cleanup job for threads idle 24 hours.

## Data model (Postgres)

One Postgres database holds compositions, page templates, flows, placements, saved versions and thread memory. Usage guidelines stay in your RAG app's own store.

Think of a filing cabinet with labeled drawers: JSON columns hold whole A2UI documents, like files in a folder, and plain tables hold the links between them, like an index card that says which tile sits on which page.

&#91;embedded content: data model · 6 tables, 1 database\]

Compositions and page templates are documents stored whole in `jsonb`. Placements are the only link table, and View Impacts reads them in both directions. Saved versions are append-only rows, never overwritten.

### Schema

```sql
create table compositions (
  id               text primary key,             -- 'basic-plan-tile'
  ds_pack          text not null,                -- 'vds'
  name             text not null,                -- 'Basic Plan – Mobile'
  type             text not null,                -- 'plan-tile'
  tags             text[] not null default '{}',
  components_used  text[] not null default '{}', -- filled on every save
  a2ui_version     text not null,                -- pinned A2UI version
  a2ui             jsonb not null,
  updated_at       timestamptz not null default now()
);

create table composition_versions (
  composition_id  text not null references compositions(id),
  version         int  not null,
  a2ui            jsonb not null,
  summary         text,
  saved_by        text,
  saved_at        timestamptz not null default now(),
  primary key (composition_id, version)
);

create table flows (
  id       text primary key,                       -- 'pdp'
  ds_pack  text not null,
  name     text not null                           -- 'PDP'
);

create table page_templates (
  id       text primary key,                       -- 'pdp-mock'
  flow_id  text not null references flows(id),
  ds_pack  text not null,
  name     text not null,
  slots    text[] not null,                        -- slot ids present in the page
  a2ui     jsonb not null
);

create table placements (
  composition_id    text not null references compositions(id),
  page_template_id  text not null references page_templates(id),
  slot_id           text not null,
  variant           text,                          -- 'full' | 'compact' | null
  position          int  not null default 0,       -- tab order in View Impacts
  primary key (composition_id, page_template_id, slot_id)
);
```

### Indexes

| Index | Serves |
| --- | --- |
| `compositions (ds_pack, type)` | The picker and the `ask` route: list by type |
| GIN on `compositions.tags` | Filtering the picker by tag |
| GIN on `compositions.components_used` | Later: "which compositions use TileContainer?" |
| `placements (page_template_id)` | "What's on this page?" (the primary key already covers "where is this tile used?") |

### Key queries

```sql
-- Picker: list and search (no model)
select id, name, type, tags from compositions
where ds_pack = $1
  and ($2::text is null or type = $2)
  and ($3::text is null or name ilike '%' || $3 || '%')
order by name;

-- View Impacts: every page a composition appears on, in tab order
select f.name as flow, pt.id, pt.name, pt.a2ui, p.slot_id, p.variant
from placements p
join page_templates pt on pt.id = p.page_template_id
join flows f on f.id = pt.flow_id
where p.composition_id = $1
order by p.position;

-- ask route: variants of a type
select id, name, tags from compositions where ds_pack = $1 and type = $2;
```

### Seeding and migrations

- Schema changes are plain numbered SQL files in `adapters/postgres/migrations`, applied by a small script at startup and in CI. No ORM.
- The checkpoint tables are created by the LangGraph Postgres checkpointer's own setup call.
- Each design system pack ships its starting data in `ds-packs/<name>/seed/` (compositions, flows, page templates, placements as JSON). A seed script upserts them, so it is safe to run again. A new design system brings its own seed.
- Local development and tests use Postgres in Docker Compose.
- All SQL lives in `adapters/postgres`. The core never sees SQL; it only calls the store ports.

## VDS grounding

Three sources, each answering one kind of question. Code decides which ones to ask; the validator has the final word.

| Source | Answers | Example question | Reached through |
| --- | --- | --- | --- |
| Catalog | Component facts: what exists, its props, allowed values | What is the shape of TileContainer, and which background tokens does it accept? | Local `catalog.json`, compiled to Zod at startup |
| Guidelines | Design usage: when and how to use a component, dos and don'ts | What are the guidelines around TileContainer background? | Your RAG endpoint |
| Compositions | Patterns and variants already in use | Which plan tile variants exist today? | Postgres (`compositions` table) |

### How gather asks

`route` returns the request type plus what it is about, for example `{ route: "edit", components: ["TileContainer"], topic: "background" }`. Then `gather`, in plain code:

- **Catalog:** always. Entries for the composition's components plus any named in the prompt. Local, so it costs nothing.
- **Guidelines:** for edits. One query per named component and topic, such as "TileContainer background usage guidelines". Results keep their source ids so a refusal can cite the guideline. Cached per thread.
- **Compositions:** for questions, and for edits that ask to follow an existing pattern. Queried by composition type and tags.

```ts
interface GatheredContext {
  catalog: CatalogEntry[];
  guidelines: { sourceId: string; text: string }[];
  variants: CompositionSummary[];
}
```

### Two tiers of rules

- **Must-never rules** are pulled out of the guidelines once, reviewed by the design team, and kept in `vds-rules.json`. The validator enforces them in code. Retrieval can miss a passage; the validator can't.
- **Advice and patterns** stay in the RAG guidelines and steer `generate`.

### Validator layers

The validator is a plain function, `validate(doc, context) → ValidationError[]`, with no model calls. `context` names the document kind (`"composition"` or `"page"`), the catalog (a `CatalogSource` port) and, for scope checks, the current document.

| Layer | Checks | Example error |
| --- | --- | --- |
| 1. Envelope | Pinned A2UI version and message kinds; exactly one root; `createSurface.catalogId` matches the pack's catalog | `catalogId` must be `https://pdesign.dev/catalog/v1/catalog.json` |
| 2. Catalog | Every component is in the pds catalog or registered as an extra; props match its schema, undeclared props rejected | `Badge.size` is not a prop of Badge |
| 3. Structure | Ids are unique, child references resolve, no orphans, `Slot` only in pages | Child `price-old` not found |
| 4. Must-never rules | Nothing breaks a rule in `rules.json` (the DS-1xx rules are placeholders) | Badge text longer than 3 words |
| 5. Scope | `surfaceId`, root id and `catalogId` match the current document | `surfaceId` changed from `main` to `other` |

Warnings (never blocking) also come from the bindings check: a binding path that doesn't resolve in the document's own data model, and an absolute path inside a repeated template.

Errors block the draft and go to repair. Warnings go to logs and traces only, never to the client.

```ts
interface ValidationError {
  severity: "error" | "warning";
  layer: "envelope" | "catalog" | "structure" | "rules" | "scope" | "bindings";
  code: string;         // stable id, e.g. "orphan", "DS-102", "scope-surface-id"
  componentId?: string; // the component the problem is on, when there is one
  path: string;         // where in the document, e.g. "components[4].props.size"
  message: string;      // plain sentence for the repair prompt and logs
  hint?: string;        // allowed values, when known
}
```

**Extras.** Components that aren't in the pds catalog are registered in `ds-packs/vds/extras/`, one file each, with a Zod schema and an `allowedIn` value (`"composition"`, `"page"` or `"both"`). `Slot` is an extra with `allowedIn: "page"`. Adding a component is: write its schema, register it in `extras/index.ts`, add its renderer entry, add a passing and a failing fixture.

### Walkthrough: "Change the TileContainer background to red"

1. **route:** edit; component TileContainer; topic background.
2. **gather:** the catalog gives the allowed background tokens; RAG gives the TileContainer background guidelines.
3. **generate:** if the guidelines rule out red, it returns a refusal that cites the guideline, with alternatives that are both allowed by the catalog and recommended by the guidelines. Otherwise it returns the edit.
4. **validate:** checks the catalog and the must-never rules, so red can't slip through even if retrieval missed the guideline.

## Streaming status

Each graph node announces when it starts and finishes, and the API turns those announcements into the `status` events the chat pane already shows. Like a kitchen calling out "order is on the grill" so the waiter can tell the table.

### Node to status label

| Node | Status label shown in chat |
| --- | --- |
| `route` | Understanding your request |
| `gather` | Looking up VDS guidelines (edits) or Finding existing variants (questions) |
| `generate` | Applying the change |
| `validate` | Checking VDS rules |
| `repair` | Fixing an issue (attempt 1 of 2) |
| `respond` | No status; sends the final event |

Labels live in one map in the code, so wording changes are a one-line edit.

### How it works

Nodes write to LangGraph's custom stream; the API forwards each item as an SSE message:

```ts
// inside a node
config.writer?.({ type: "status", stepId: "validate", label: LABELS.validate, state: "running" });
const errors = validate(state.draft, ctx);
config.writer?.({ type: "status", stepId: "validate", label: LABELS.validate, state: "done" });

// in the route handler
for await (const event of graph.stream(input, { configurable: { thread_id }, streamMode: "custom", signal })) {
  sse.write({ event: event.type, data: JSON.stringify(event) });
}
```

The final `result`, `refusal`, `scope` or `error` event is written the same way by the `respond` node, so the route handler stays a simple loop with no special cases.

## Tech stack and repo structure

The same stack as the existing backend, minus everything the foundation doesn't need yet.

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | Bun + TypeScript (strict), workspaces monorepo | Same as the existing backend |
| HTTP and SSE | Hono | Small, built-in SSE helper, runs on Bun |
| A2A | Official A2A JavaScript SDK (`@a2a-js/sdk`) | Protocol layer only; agent logic stays in the core |
| Agent graph | LangGraph JS | Explicit nodes and edges |
| Schemas | Zod | Request validation, catalog schemas, model structured output |
| Model | Anthropic API through the `ModelClient` port | Base URL, key and model id from env, so the org gateway is config only |
| Database | Postgres, one database | Compositions, page templates, mappings, versions, thread memory |
| Database access | `pg` driver and plain SQL; numbered SQL migration files | Same driver the LangGraph checkpointer uses; no ORM |
| Checkpointer | LangGraph Postgres checkpointer from B2 | Setup reused from the existing backend |
| Design system | A design system pack (`DS_PACK=vds`) | Catalog, rules, prompt wording, seed data, golden scenarios |
| Guidelines | RAG endpoint adapter | Responses cached per thread |
| Local development | Docker Compose with Postgres | Same setup runs the tests |
| Observability | OpenTelemetry + LangSmith | Added in B5 |
| Tests | `bun test` | Unit tests plus each pack's golden scenarios |

Not in the foundation: BullMQ, a database for compositions, auth beyond a shared key.

### Shared contract package

The `AgentRequest` and `AgentEvent` types, written as Zod schemas, live in one small package that both the playground and the backend import. If the contract changes, both sides fail to compile until they agree. The same package holds `vds-rules.json`.

The A2UI v0.9 wire types (`A2UIDocument`, `A2UIMessage`, `A2UIComponentNode` and the rest) also live in this package, as TypeScript interfaces with Zod schemas beside them. Components are loose: `id` and `component` are required, other props are allowed. Prop rules belong to the validator and the catalog. The contract's version history is in `server/packages/contract/CHANGELOG.md`.

**Contract changes so far (2026-10-03):**
- `A2UIDocument.meta` is optional. Documents without a header are valid; the playground's type already allowed this.
- `PlacementView` has `flowId`, the key for the impacts tabs.
- `AgentRequest` has no `threadId`. The thread id is the URL path segment, and the playground passes it as the first argument to `sendPrompt(threadId, request, signal?)`.

### Repo structure

```text
experience-agent/
  CLAUDE.md
  docker-compose.yml              # Postgres for local development and tests
  docs/PLAN.md                    # this document, exported as Markdown
  packages/
    contract/                     # AgentRequest, AgentEvent, composition types (Zod); shared with the UI
    core/                         # no vendor, database or design system code
      src/ports.ts                # CatalogSource, GuidelineSource, CompositionStore, ModelClient, AgentEngine, ThreadLock
      src/runAgent.ts             # the one function both doors call
      src/agent/                  # nodes.ts, state.ts, routing.ts, schemas.ts
      src/graph/labels.ts         # status labels
      src/validator/              # engine: five layers
    adapters/
      postgres/                   # CompositionStore, ThreadLock (all SQL lives here)
        migrations/               # 001_compositions.sql, 002_placements.sql, ...
        seed.ts                   # upserts a pack's seed data
      langgraph/                  # StateGraph wiring, AgentEngine, Postgres checkpointer
      anthropic/                  # ModelClient (base URL + key from config)
      guidelines/                 # GuidelineSource: file stub now, RAG endpoint later
  ds-packs/
    vds/                          # pack.json, catalog.json, rules.json, prompts/, seed/, golden/
  apps/
    service/
      src/http/                   # compositions, placements, prompts (SSE), threads, health
      src/a2a/                    # agent card + executor
      src/config.ts               # DATABASE_URL, DS_PACK, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, MODEL_ID, ...
      src/wire.ts                 # picks adapters from config and builds the core
  tests/
    unit/
    golden-runner/                # runs a pack's golden scenarios
```

To take the agent to another system, copy `contract`, `core` and whichever adapters fit, then write a new `wire.ts`.

## Build order

Seven building blocks, each usable on its own. Lay the pipe before adding the brain: the playground talks to the real server from B0, even before any model is involved.

### B0 — Skeleton and pipe

- [ ] Monorepo split from day one: `contract`, `core`, `adapters`, `ds-packs/vds`, `apps/service`
- [ ] A lint rule stops `core` from importing any adapter, pack or vendor SDK
- [ ] Postgres in Docker Compose; migrations create the five tables and indexes from the Data model section
- [ ] Seed script loads the VDS pack's compositions, flows, page templates and placements; running it twice changes nothing
- [ ] Bun + Hono server with `/health` (checks the database)
- [ ] The three composition endpoints go through the `CompositionStore` port, no model, under 200 ms
- [ ] `POST /v1/threads/:threadId/prompts` validates the body and streams a scripted sequence (three status steps, then a `result` echoing the input A2UI)
- [ ] The playground picks a real template, shows the scripted steps, and opens View Impacts from real placements

### B1 — Validator

- [ ] Compiled catalog schemas and `vds-rules.json` load at startup
- [ ] All five validator layers, one file each, no model calls
- [ ] Unit tests: one passing fixture and at least one failing fixture per layer

### B2 — Graph with the model

- [x] `route`, `gather`, `generate`, `validate`, `respond` nodes wired in LangGraph with the Postgres checkpointer (the route node is the graph node `classify`; its status step is still `route`)
- [ ] `gather` reads the local catalog and the RAG endpoint; guideline results carry source ids (catalog and source ids done; the guideline source is a file stub until the RAG endpoint's shape is known)
- [x] Status events stream from each node
- [x] A follow-up prompt in the same thread uses the earlier conversation (also across an engine restart, on Postgres)
- [x] Golden tests pass for: approved cap color, highlight price difference (one repair, DS-105), smaller badge

### B3 — Repair, refusal, scope

- [x] Repair loop, at most 2 attempts, then an `error` event (tested in the graph tests)
- [ ] Refusals that cite the guideline, with alternatives checked against the catalog and rules (the refusal path works; the citation and alternative checks are not built yet)
- [ ] `ask` route: `gather` queries Postgres and `respond` sends an `answer` with references (`ask` currently sends a non-retryable error)
- [x] Scope route for other experiences and page parts (golden "Change the PDP header")
- [ ] Cancellation on disconnect (the signal is passed through and the thread lock is released in `finally`; no test yet)
- [x] HTTP 409 for overlapping prompts on one thread, with a Postgres advisory lock on its own pool; different threads run in parallel
- [ ] All six golden scenarios pass, plus one "which variants exist?" question (four goldens exist; the off-brand refusal and the variants question are not built)
- [x] Opt-in live test: `LIVE_MODEL_TESTS=1` sends the golden prompts to the real model and checks the outcome type and the validator, not the JSON

### B4 — Thread lifecycle

- [ ] `DELETE /v1/threads/:threadId` removes the thread's checkpoints
- [ ] Cleanup job deletes threads idle for 24 hours
- [ ] A follow-up prompt works after a server restart
- [ ] "One prompt per thread" (HTTP 409) holds across more than one service instance, using a Postgres advisory lock

### B5 — Observability and hardening

- [ ] OpenTelemetry and LangSmith traces, one trace per prompt, tagged with `threadId`
- [ ] Shared-key auth header for internal testing
- [ ] Timeout per model call and per run
- [ ] Golden suite runs in CI and fails the build below an agreed pass rate

### B6 — A2A entry point

- [ ] Agent card at `/.well-known/agent-card.json` with the `edit-experience` and `find-variants` skills
- [ ] Executor maps handoff messages to `AgentRequest` and events to A2A task updates, as in the mapping table
- [ ] `contextId` becomes `threadId`; a refusal comes back as input-required and a reply in the same context continues
- [ ] Bearer token per calling agent
- [ ] A test agent hands off "highlight the price difference" and receives a valid A2UI artifact

## Claude Code kickoff

Export this doc as Markdown to `docs/PLAN.md`, add the `CLAUDE.md` below, and run one building block at a time.

### CLAUDE.md seed

```markdown
# Experience Agent (backend)

A Bun service that runs a fixed LangGraph flow to edit A2UI compositions
grounded in a design system. Two front doors share one core: HTTP + SSE for
the Experience Playground, and A2A for other agents. One Postgres database
holds compositions, mappings and thread memory. Full plan: docs/PLAN.md.
Read it before any task.

## Rules
- Full control: every step is an explicit LangGraph node. Never let the model
  choose which nodes run.
- packages/core must not import adapters, design system packs, vendor SDKs or
  database code. It talks only to the ports in core/src/ports.ts.
- Both doors call runAgent(). No agent logic in http/ or a2a/.
- Everything design-system specific lives in ds-packs/<name>, including seed data.
- All SQL lives in adapters/postgres. Change the schema only by adding a new
  numbered migration file; never edit an applied one.
- The contract package is the spec. Never change it without saying so; the
  playground imports the same package.
- Nothing reaches a caller without passing validate(). No exceptions.
- The validator engine is plain code with no model calls.
- Template and placement reads never call the model.
- Config comes from env (DATABASE_URL, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY,
  MODEL_ID, DS_PACK, ...). Never hardcode URLs or keys, and never log keys.
- The caller's currentA2ui is the source of truth. Store only short summaries
  in thread messages, never whole A2UI documents.
- Reuse the existing catalog compiler, validator and Postgres checkpointer
  setup where they exist; ask before rewriting them.
- Keep it simple: no queues, extra services or dependencies beyond the plan's
  stack table without asking.
- One building block at a time. Finish with its acceptance criteria checked
  and tests passing, then stop and summarize.
```

### Building block prompts

1. **B0:** "Read docs/PLAN.md and CLAUDE.md. Plan B0 and show me the plan. Set up the monorepo exactly as the Repo structure section shows, with the core import rule enforced. Add Postgres in Docker Compose, the migrations and the VDS seed from the Data model section. Then build the contract package, the three composition endpoints and the scripted streaming endpoint. Stop when B0's checklist passes."
2. **B1:** "Plan B1. Show me what you'll reuse from the existing catalog compiler and validator before writing new code. Build the validator engine in core and the VDS pack's catalog and rules, with fixture tests."
3. **B2:** "Plan and build B2: the route, gather, generate, validate and respond nodes with status streaming, the Postgres checkpointer, the Anthropic and RAG adapters, and runAgent. Add golden tests for the three edit scenarios."
4. **B3:** "Plan and build B3: the repair loop, refusals, the ask route with the answer event, the scope route, cancellation and the 409 rule. All golden scenarios must pass."
5. **B4:** "Plan and build B4: thread delete, the 24-hour cleanup, restart recovery and the advisory lock for the 409 rule."
6. **B5:** "Plan and build B5: tracing, the shared-key header, timeouts, and the golden suite in CI."
7. **B6:** "Plan and build B6: the A2A door with the agent card, executor and outcome mapping from the plan, plus a small test agent that hands off a prompt."

## Later building blocks and open questions

Each later block plugs into the foundation without changing the graph's core flow. Two open questions block early building blocks.

### Later building blocks

| Block | What it adds | Plugs in at |
| --- | --- | --- |
| Server-side saves | Edited compositions saved as rows in `composition_versions` | New method on `CompositionStore`; replaces the UI's `localStorage` saves |
| Job queue (BullMQ) | Long or batch runs outside the request | Wraps `runAgent` |
| New components | Agent decides reuse versus building a new composition | New node after `gather` |
| Component-level impact | "Which compositions use TileContainer?" | A query on `components_used`; the index already exists |
| Publish flow | Hand off to the DS library MR flow | Separate call after save |
| Impact analysis | Agent comments on each impact page | New node after `validate` |
| Object store | Thumbnails, screenshots and exported assets | New adapter; A2UI documents stay in Postgres |
| Second design system | Another team's components | A new pack and seed, plus renderer mapping in the UI |

### Open questions

- [ ] Blocks B0: does your org provide a managed Postgres for this, and which version?
- [ ] Blocks B0: how should compositions be tagged (type, tags, flows) in the seed data?
- [ ] Blocks B1: pin A2UI v0.9.1 or v1.0 RC?
- [ ] Blocks B2: what does the RAG endpoint accept and return (query in; passages with source ids out)?
- [ ] Blocks B6: which A2A protocol version do the calling agents speak (v0.3 or v1.0)?
- [ ] How do calling agents get their bearer tokens?
- [ ] Who extracts the must-never rules from the guidelines into `rules.json`, and who reviews them?
- [ ] A new `experience-agent` repo, or a module inside the existing LangGraph backend?
- [ ] What golden-suite pass rate should fail CI?

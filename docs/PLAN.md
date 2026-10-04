# Experience Playground — Build Plan and System Architecture

Oct 2, 2026 · @Shadab

## Overview

Phase 1 builds the full Experience Playground UI against a mocked agent and mocked pages, so the whole designer loop can be tested before any real AI or backend work.

The Experience Playground is a two-pane workspace. A designer picks an existing VDS experience (for example, the Basic Plan tile), asks an agent in plain language to change it, sees the result rendered from A2UI JSON, and checks how the change looks on every real page where that tile appears.

### Phase 1 goal

A clickable, realistic UI where every agent behavior is scripted. No LLM calls and no backend. Compositions and pages render as real VDS components through an A2UI renderer, so what designers see is what production would render.

### Success criteria

- A designer can run the full loop without help: pick, prompt, watch live status, see the result, undo, view impacts on three pages, save, and leave with an unsaved-changes warning.
- Every rendered element in the preview comes from A2UI JSON, and the JSON view always matches what is on screen.
- Replacing the mock agent with the real Experience Agent changes one module (the agent adapter) and nothing in the UI.

### In scope

- Experience picker with search
- Chat pane with streamed status, results, refusals with alternatives, and scope notices
- Preview pane: single preview, A2UI JSON view, Copy, Save, undo and versions
- View Impacts: one tab per mapped page (PDP, AAL, Order Summary), each a mock of the real page with the tile in its slot
- Task state locked to one composition, with an unsaved-changes warning before leaving

### Out of scope for phase 1

- A real LLM or LangGraph agent
- Publishing to the DS library or the MR flow
- Agent analysis of impacts (impact tabs only render)
- Saving as a new template, sharing saves between users, and authentication

## Key concepts

Every term below is used with exactly this meaning in the code, the UI copy, and this plan.

| Term | Plain meaning | In this app |
| --- | --- | --- |
| Experience | A ready-made piece of UI a designer can work on | A tile in the picker, such as Basic Plan – Mobile |
| A2UI | UI described as data. Like a recipe: the JSON says which components, in what order, with what content; a renderer cooks it into real UI | The format of every composition and page template |
| Composition | The A2UI JSON behind one experience | What the agent edits. One composition per task |
| Tile | What a composition looks like once rendered | Shown in the preview and in each impact tab |
| VDS | Verizon Design System: the approved components and tokens | The only building blocks the agent may use |
| Flow | A customer journey made of pages | PDP (product detail page), AAL (Add a Line), Order Summary |
| Page template | A mock of a real page, written as A2UI, with labelled empty spots | One per impact tab |
| Slot | A named empty spot in a page template where a composition goes | Like a seat on a seating chart |
| Mapping | The seating chart: which pages use a composition, and in which slot | Drives the impact tabs |
| Task | One working session on one composition | Starts at pick; ends at close, complete, or switching |
| Version | A snapshot of the composition after each change | Exists only while the task is open; powers undo |
| Saved version | The version the user explicitly saved | The only thing that survives the task |
| Impacts view | Tabs that render every mapped page with the current version in its slot | Render only, no analysis |
| Scope guard | The rule that prompts can change only the active composition | Page scenery and other experiences are read-only |

## Screens and UX spec

One screen with two panes: conversation on the left (about 40% wide), the rendered result on the right (about 60%).

```text
+------------------------------------------------------------------------------+
| Experience Playground · Powered by VDS (Verizon Design System)               |
+-------------------------------+----------------------------------------------+
| [Pick an experience]          | [Unsaved · v4] [Undo][Redo]  [A2UI JSON][Copy]|
| Basic Plan – Mobile    [x]    |                    [Save]   [View impacts]   |
|                               |  ( Preview | JSON | Impacts: PDP AAL Order )  |
|  chat thread                  |                                              |
|  - agent / user messages      |          rendered A2UI (VDS components)      |
|  - live status steps          |                                              |
|  - result, refusal, notices   |                                              |
|                               |                                              |
| ( Describe a change...    > ) |                                              |
+-------------------------------+----------------------------------------------+
```

### Before an experience is picked

- Preview pane shows an empty state: "Show experience preview" and "All UI rendered here is A2UI based". Toolbar buttons are hidden.
- Input placeholder: "Start by choosing an experience or type to search by experience name".
- Typing filters the catalog. Enter with exactly one match picks it.
- Pick an experience opens a tile grid of the catalog (Basic Plan – Mobile, Home Plan, Order Summary) above the chat.

### Picking an experience

- The tile grid closes, the composition renders in the preview, and a new task starts.
- The left pane header shows the experience name and a Close task button.
- Agent message: "You selected Basic Plan – Mobile. What would you like to work on? You can ask me to design, update, or modify this experience within brand guidelines."
- Placeholder changes to "Describe a change…".

### Prompting (the core loop)

1. The user message appears as a bubble. Input is disabled while the agent works.
2. Status steps stream in one at a time, each with a spinner that turns into a check (for example: Reading the tile structure → Checking VDS patterns → Applying change → Validating against brand rules).
3. A done message summarizes what changed, names the new version, and says it isn't saved yet.
4. The preview updates when the done message arrives. If the Impacts view is open, the user stays on the same tab and it re-renders in place.

### Agent responses that create no new version

- **Refusal.** The request breaks a VDS rule (for example, an off-palette cap color). The agent explains why in one or two sentences and offers two or three approved alternatives as clickable chips. A chip sends its text as the next prompt.
- **Scope notice.** The request targets another experience or page scenery. The agent says it is working on the active composition only and suggests closing the task to switch.
- **Unsupported (mock only).** The prompt matches no scripted scenario. The agent says so and lists supported prompts as chips.
- **Error.** Something failed. Show a short message with a Retry chip.

### Preview toolbar

- **Status pill:** amber "Unsaved changes · v4" or green "Saved · v3".
- **Undo and Redo:** move between versions. A quiet system line in chat confirms ("Back to version 3").
- **A2UI JSON:** toggles the right pane between rendered preview and read-only, formatted JSON of the current version.
- **Copy:** copies the current version's JSON. A toast confirms "JSON copied".
- **Save:** the only primary (filled) button. Saves the current version and confirms in chat ("Saved version 4").
- **View impacts:** toggles the Impacts view.
- **Device toggle (preview and impacts):** mobile or desktop width.

### Impacts view

- One tab per entry in the composition's mapping, in mapping order (PDP, AAL, Order Summary).
- Each tab renders the full mock page with the current version placed in its slot.
- The placed tile has a dashed outline and an "Updated tile" tag so the eye finds it immediately.
- Page scenery is read-only. Impacts only render; there is no agent commentary.

### Leaving a task

- Leaving happens through Pick an experience, Close task, or closing the browser tab.
- With unsaved changes, an inline warning appears: "You have unsaved changes to Basic Plan. Save them before leaving?" with Save and leave, Discard, and Stay. Browser tab close uses the native leave-page prompt.
- Discard keeps the last saved version and drops everything after it.
- With no unsaved changes, the task closes without a prompt.

## System architecture

The UI depends on exactly two interfaces, `AgentClient` and `Repository`. In phase 1, mocks sit behind them; later the real Experience Agent and a repository API plug into the same seams with no UI changes.

```text
                        UI modules (picker, chat, preview, impacts)
                                      |
                                      v
                              task store (Zustand)
                                /              \
                               v                v
                      AgentClient         Repository
                      /          \         /          \
                     v            v       v            v
            MockAgentClient  RemoteAgentClient   MockRepository   (real Repository API)
             (phase 1)        (later: LangGraph     (phase 1:        (later)
                                Experience Agent     fixtures +
                                over SSE)             localStorage)
```

Read it top down: UI modules read and write the task store; only the store calls the two interfaces; each interface has a mock now and a real service later.

### How a prompt travels

1. The chat input calls `taskStore.sendPrompt(text)`.
2. The store sets `agentStatus` to working and calls `AgentClient.sendPrompt` with the thread id, the locked composition id, the current version's A2UI, and the prompt.
3. The client streams events. The store appends status steps as they arrive.
4. On `result`, the store adds a version and moves `currentVersion` to it. Preview, JSON view, and impact tabs re-render from the store.
5. On `refusal`, `scope`, or `error`, the store adds a chat message only. No version is created.

### Interface contract

```ts
interface AgentRequest {
  threadId: string;
  experienceId: string;
  compositionId: string;      // the lock
  currentA2ui: A2UIDocument;  // current version, so the agent edits what the user sees
  prompt: string;
}

type AgentEvent =
  | { type: "status"; stepId: string; label: string; state: "running" | "done" }
  | { type: "result"; a2ui: A2UIDocument; summary: string; message: string }
  | { type: "refusal"; reason: string; alternatives: string[] }
  | { type: "scope"; message: string }
  | { type: "error"; message: string; retryable: boolean };

interface AgentClient {
  sendPrompt(req: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

interface Repository {
  listExperiences(): Promise<Experience[]>;
  getComposition(id: string): Promise<Composition>;
  getMapping(compositionId: string): Promise<CompositionMapping>;
  getPageTemplate(id: string): Promise<PageTemplate>;
  getSavedComposition(compositionId: string): Promise<SavedComposition | null>;
  saveComposition(saved: SavedComposition): Promise<void>;
}
```

A `result` event always carries the whole new A2UI document, never a patch. The mock applies its scenario patch internally and emits the full result, so the UI never has to know how an edit was made.

### Target architecture (later)

The Experience Agent runs on LangGraph. One LangGraph thread equals one task, so its per-thread checkpointing holds the conversation and version history. The agent is grounded in the VDS component catalog, tokens, and brand rules, and streams the same `AgentEvent` types over server-sent events.

## Data models

The app treats A2UI documents as data it stores, versions, and renders. It never hardcodes a tile's layout in React.

### Catalog, compositions, pages, and mapping

```ts
// Follows the A2UI spec version the VDS team already uses. The app never
// reaches inside it except through the renderer and the page composer.
type A2UIDocument = unknown;

interface Experience {
  id: string;              // "basic-plan-mobile"
  name: string;            // "Basic Plan – Mobile"
  description?: string;
  compositionId: string;   // the composition this experience edits
}

interface Composition {
  id: string;              // "basic-plan-tile"
  name: string;
  a2ui: A2UIDocument;      // the original template
}

interface PageTemplate {
  id: string;              // "pdp-mock"
  name: string;            // "PDP"
  a2ui: A2UIDocument;      // a mock of the real page
  slots: { id: string; description: string }[];  // placeholder nodes in a2ui
}

// The seating chart: where a composition appears.
interface CompositionMapping {
  compositionId: string;
  appearsIn: Placement[];  // order = tab order in the Impacts view
}

interface Placement {
  flowId: string;          // "pdp" | "aal" | "order-summary"
  flowName: string;        // tab label
  pageTemplateId: string;
  slotId: string;          // which placeholder in the page receives the composition
  variant?: string;        // optional: "full" | "compact" if the page renders it differently
}
```

The page composer places a composition by replacing the slot's placeholder node with the composition's root. If the A2UI format uses a flat component list with ids, the composer prefixes the composition's ids (for example, `slot-plan-summary/…`) so they never collide with page ids.

### Task state

```ts
interface Version {
  number: number;          // 1 = the template (or the saved version) the task started from
  a2ui: A2UIDocument;
  summary: string;         // "Added a savings badge and old price"
  createdAt: string;       // ISO timestamp
}

interface TaskState {
  threadId: string;
  experienceId: string;
  compositionId: string;   // the lock: every prompt targets only this
  versions: Version[];
  currentVersion: number;  // moves with undo and redo
  lastSavedVersion: number | null;
  baselineVersion: number; // lastSavedVersion ?? 1
  view: {
    mode: "preview" | "json" | "impacts";
    impactTab?: string;    // flowId of the active tab
    device: "mobile" | "desktop";
  };
  agentStatus: "idle" | "working";
  messages: ChatMessage[];
}

// Derived, never stored:
// hasUnsavedChanges = currentVersion !== baselineVersion
```

A new prompt after an undo discards the versions ahead of `currentVersion`, the same way a text editor drops redo history.

### Chat messages

```ts
type ChatMessage =
  | { kind: "user"; id: string; text: string }
  | { kind: "agent"; id: string; text: string }
  | { kind: "status"; id: string; steps: { id: string; label: string; state: "running" | "done" }[] }
  | { kind: "result"; id: string; version: number; summary: string }
  | { kind: "refusal"; id: string; reason: string; alternatives: string[] }
  | { kind: "scope"; id: string; text: string }
  | { kind: "system"; id: string; text: string }   // "Saved version 4", "Back to version 3"
  | { kind: "error"; id: string; text: string; retryPrompt?: string };
```

### Saved versions

```ts
interface SavedComposition {
  compositionId: string;
  a2ui: A2UIDocument;
  summary: string;
  savedAt: string;
}
```

Phase 1 keeps one saved composition per `compositionId`. A later save overwrites the earlier one.

## Mock layer

The mock agent behaves like the real one from the UI's point of view: same interface, same streamed events, realistic timing. Every scripted behavior is data, not code, so new demo scenarios need no UI changes.

### Mock agent

Each scenario is a JSON file:

```ts
interface MockScenario {
  id: string;
  experienceIds: string[];        // which experiences it applies to
  match: string[];                // case-insensitive regex patterns tested on the prompt
  steps: { label: string; ms: number }[];  // status steps, 400–900 ms each
  outcome:
    | { kind: "edit"; patch: JsonPatchOp[]; summary: string; message: string }
    | { kind: "refusal"; reason: string; alternatives: string[] }
    | { kind: "scope"; message: string };
}
```

- Edits are RFC 6902 JSON Patch operations applied to the current version's A2UI. That keeps edits stackable: prompts in any order build on each other.
- First matching scenario wins. No match gives the "unsupported" reply with supported prompts as chips.
- A prompt mentioning another experience's name, or page parts such as "header", "footer" or "PDP page", hits the scope scenario before anything else.

### Demo scenarios to ship

| Scenario | Example prompt | Outcome |
| --- | --- | --- |
| Cap color, approved | "Change the cap color to red" | Edit: cap uses the approved VDS red token |
| Cap color, off-brand | "Make the cap neon pink" or any hex code | Refusal: not in the VDS palette; offers the closest approved colors |
| Highlight price difference | "Customers say the price difference isn't clear, highlight it" | Edit: savings badge plus struck-through old price |
| Smaller badge | "Make the badge smaller" | Edit: badge uses the small VDS size |
| Out of scope | "Change the PDP header" | Scope notice |
| Anything else | — | Unsupported reply with chips |

### Mock VDS rules

As built, each scenario file carries its own `outcome.alternatives`, so refusal
alternatives live next to the refusal that offers them. The planned shared
`vds-rules.json` was not needed; the backend's equivalent is
`server/ds-packs/vds/rules.json`, which the validator enforces.

### Mock pages

Three A2UI page templates (PDP, AAL, Order Summary) built from real VDS components with realistic placeholder content: plan names, prices, neighboring cards, and buttons. Each has one slot for the plan tile. They are mocks of real pages, not wireframes, so impacts look believable.

### Mock repository

- Catalog, compositions, page templates, mapping, and scenarios load from static JSON fixtures.
- Saved compositions live in `localStorage`, keyed by `compositionId`.
- A small dev panel (dev builds only) sets agent speed (instant, normal, slow), forces the next prompt to fail, and clears saved data.

## Frontend implementation

React and TypeScript on Vite, VDS components for both the playground chrome and the rendered compositions, and one small state store per task.

### Stack

| Concern | Choice | Why |
| --- | --- | --- |
| App | React 18 + TypeScript (strict) + Vite | VDS is a React library; Vite gives fast reloads for UI testing |
| UI components | VDS React components and tokens | The playground itself should look like a VDS product |
| State | Zustand, one store for the task plus a small UI store | Simple, testable, no boilerplate |
| A2UI rendering | The team's existing VDS A2UI renderer if one exists; otherwise a registry renderer (below) | Reuse beats rebuild |
| JSON edits | `fast-json-patch` | Applies the mock scenarios' RFC 6902 patches |
| JSON view | Read-only formatted view with a lightweight syntax highlighter | Read-only in phase 1 |
| Unit tests | Vitest + React Testing Library | Store, agent adapter, composer, renderer |
| End-to-end tests | Playwright | The full designer loop |

### Repo structure

```text
experience-playground/
  CLAUDE.md
  docs/PLAN.md                      # this document, exported as Markdown
  src/
    app/                            # App shell, layout, header, routing (single route)
    features/
      picker/                       # Catalog tile grid + search
      chat/                         # Thread, message renderers, status steps, chips, input
      preview/                      # Toolbar, preview, JSON view, device toggle
      impacts/                      # Tabs + page composer view
      task/                         # Task store, version logic, unsaved guard
    a2ui/
      renderer/                     # A2UI -> VDS components (registry)
      composer/                     # Places a composition into a page slot
    services/
      agent/
        AgentClient.ts              # Interface + AgentEvent types
        MockAgentClient.ts          # Phase 1
        RemoteAgentClient.ts        # Later: real Experience Agent over SSE
      repository/
        Repository.ts               # Interface
        MockRepository.ts           # Fixtures + localStorage
    mocks/
      experiences.json
      compositions/*.json
      pages/*.json
      mappings.json
      scenarios/*.json
    dev/DevPanel.tsx                # Dev builds only
  tests/e2e/                        # Playwright specs
```

### Renderer

If no renderer exists yet, build a registry: a map from A2UI component type names to VDS React components. The renderer walks the A2UI document, looks up each type, and passes props and children through. An unknown type renders a visible "Unsupported component: \<type>" box instead of failing silently, so gaps show up in testing.

### Rules for the codebase

- UI components read and write state only through the stores. They never call the agent or the repository directly.
- Only the task store calls `AgentClient` and `Repository`. Swapping mocks for real services touches `services/` only.
- No component knows a tile's layout. Everything the preview shows comes from A2UI.
- The JSON view and Copy always read the same `currentVersion` the preview renders.

## Build milestones

Seven milestones, built in order. Each one ends with something clickable, and its acceptance criteria are the checklist to tick before starting the next.

### M0 — Scaffold

Vite + React + TypeScript (strict), VDS packages installed, Zustand, Vitest, Playwright, linting, and the folder structure above.

- [ ] App runs and shows the header bar styled with VDS
- [ ] `npm test` and `npm run e2e` both run (with one placeholder test each)
- [ ] `CLAUDE.md` and `docs/PLAN.md` are in the repo

### M1 — A2UI renderer, fixtures, and page composer

- [ ] Basic Plan tile composition renders from JSON using VDS components
- [ ] PDP, AAL, and Order Summary mock pages render, each with the tile placed in its slot
- [ ] An unknown component type shows the "Unsupported component" box
- [ ] Unit tests cover the composer's slot replacement and id prefixing

### M2 — Shell and picker

- [ ] Two-pane layout with the empty state from the UX spec
- [ ] Pick an experience shows the tile grid; search filters it; Enter picks a single match
- [ ] Picking starts a task, renders the preview, posts the greeting, and switches the placeholder to "Describe a change…"

### M3 — Chat and mock agent

- [ ] `AgentClient` interface and `MockAgentClient` stream events from scenario files
- [ ] Status steps appear one at a time and turn into checks
- [ ] All six demo scenarios behave as in the Mock layer table
- [ ] Refusal and unsupported chips send their text as the next prompt
- [ ] Input is disabled while the agent works

### M4 — Versions, save, JSON, and copy

- [ ] Every edit creates a version; undo and redo move between them; a new prompt after undo drops redo history
- [ ] Status pill shows unsaved or saved correctly, including after undo back to the saved version
- [ ] Save stores to `localStorage` and confirms in chat
- [ ] JSON view and Copy always match the rendered version

### M5 — View impacts

- [ ] Tabs come from the mapping, in mapping order
- [ ] Each tab renders the full mock page with the current version in its slot, outlined and tagged
- [ ] A prompt made on an impact tab re-renders that tab in place
- [ ] Device toggle works in preview and impacts

### M6 — Leaving a task, polish, and end-to-end tests

- [ ] Unsaved warning on Pick an experience and Close task, with Save and leave, Discard, and Stay
- [ ] Native leave-page prompt on tab close when unsaved
- [ ] Dev panel: agent speed, force failure, clear saved data
- [ ] Playwright covers the full loop: pick, prompt, refusal, undo, impacts, save, leave with warning

### Later — Real agent

Replace `MockAgentClient` with `RemoteAgentClient`, which talks to the Experience Agent (LangGraph, per-thread state) over server-sent events, using the same event contract. No UI changes should be needed.

## Claude Code kickoff

Export this doc as Markdown into `docs/PLAN.md`, add the `CLAUDE.md` below, then run one milestone prompt at a time and review before moving on.

### Setup

1. Create an empty repo named `experience-playground`.
2. Export this doc as Markdown and save it as `docs/PLAN.md`.
3. Save the block below as `CLAUDE.md` at the repo root.
4. Start Claude Code in the repo and run the M0 prompt.

### CLAUDE.md seed

```markdown
# Experience Playground

A two-pane workspace where designers pick a VDS experience, prompt an agent to
change it, and see the result rendered from A2UI JSON, including its impact on
the real pages where it appears. Full plan: docs/PLAN.md. Read it before any task.

## Phase 1 rules
- UI first. No real LLM, no backend. All agent behavior comes from mock
  scenario JSON in src/mocks/scenarios.
- The UI talks to two interfaces only: AgentClient and Repository
  (src/services). Only the task store calls them.
- Everything shown in the preview and impact tabs is rendered from A2UI.
  Never hardcode a tile's layout in React.
- Use VDS components and tokens for all UI. Ask before adding any other UI library.
- TypeScript strict. No `any` except the opaque A2UIDocument type.
- Use the exact terms from the Key concepts table (composition, slot, mapping,
  task, version, saved version).
- Work one milestone at a time. Finish with its acceptance criteria checked
  and tests passing, then stop and summarize.
- Ask before adding a dependency not listed in the plan's Stack table.
```

### Milestone prompts

Run these one at a time. Each one asks Claude Code to plan first, so you can correct the approach before code is written.

1. **M0:** "Read docs/PLAN.md and CLAUDE.md. Plan milestone M0, show me the plan, then scaffold the project exactly as the Repo structure section describes. Stop when M0's acceptance criteria pass."
2. **M1:** "Plan M1. First check whether a VDS A2UI renderer package is available to us; if not, build the registry renderer described in the plan. Create the Basic Plan tile composition and the three mock pages as fixtures, then the page composer with unit tests."
3. **M2:** "Plan and build M2 following the Screens and UX spec sections 'Before an experience is picked' and 'Picking an experience'. Use the exact copy from the spec."
4. **M3:** "Plan and build M3. Implement AgentClient and MockAgentClient using the MockScenario format, and add the six demo scenarios from the Mock layer table. Message types must match the ChatMessage union."
5. **M4:** "Plan and build M4: versions, undo and redo, the status pill, Save to localStorage, the JSON view, and Copy, following the TaskState model and the Preview toolbar spec."
6. **M5:** "Plan and build M5: the Impacts view driven by mappings.json, using the page composer from M1. A prompt made on an impact tab must keep the user on that tab."
7. **M6:** "Plan and build M6: the leave-task guard, the dev panel, and a Playwright test of the full designer loop described in the Overview success criteria."

## Decisions and open questions

Nine decisions are settled. Five questions need an answer, and two of them block M1.

### Decisions

| Area | Decision |
| --- | --- |
| Chat pane | Streams live status during work, then a done message pointing to the preview |
| Brand rules | Off-brand requests are refused with a reason and approved alternatives |
| History | Undo, redo, and versions are in scope |
| Input | Placeholder switches to "Describe a change…" once an experience is picked |
| Export | Copy and the A2UI JSON view only, for now |
| Impacts | Tabs per mapped page, mocks of real pages, render only with no agent analysis |
| Mapping | Each composition maps to flows, pages, and slots |
| Task state | Locked to one composition until the task is closed or completed |
| Saving | Saved is kept, unsaved is lost; Save button plus a warning before leaving |

### Open questions

- [ ] Blocks M1: which A2UI spec version do we use, and is there already a VDS A2UI renderer to reuse?
- [ ] Blocks M1: can the prototype install VDS packages from the internal registry?
- [ ] When someone picks an experience that has a saved version, do they start from it or from the original template? Default for now: start from the saved version.
- [ ] Are saved versions stored per browser only (`localStorage`) acceptable for phase 1 testing?
- [ ] Which real page content should the PDP, AAL, and Order Summary mocks copy?

### Later

Real Experience Agent over LangGraph, save as a new template, the publish and MR flow, agent analysis of impacts, and shared saves between users.

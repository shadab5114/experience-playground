# Experience Playground

A two-pane workspace where designers pick a VDS experience, prompt an agent to
change it, and see the result rendered from A2UI JSON, including its impact on
the real pages where it appears. Full plan: docs/PLAN.md. Read it before any task.

## Repo map
- Playground: repo root (src/, tests/). Plan: docs/PLAN.md.
- Backend: server/ (Node LTS + Hono + Postgres; Bun-only APIs avoided).
  Plan: docs/BACKEND_PLAN.md. Rules: server/CLAUDE.md. Backend paths in that
  plan are relative to server/.
- Shared contract: server/packages/contract (AgentRequest, AgentEvent, composition
  types). Both the playground and the backend import it; do not duplicate these types.
- Backend code lives only in server/.
- Porting this app to another org / design system: docs/PORTING.md.

## Core rules
- Mock is the default; remote mode talks to the Experience Agent backend.
  Mock: all agent behavior comes from scenario JSON in src/mocks/scenarios.
  Remote: set VITE_DATA_SOURCE=remote and run the backend in server/.
- The UI talks to two interfaces only: AgentClient and Repository
  (src/services). Only the task store calls them. The Studio's equivalent is
  AuthoringRepository, called only by src/features/studio/studioStore.ts.
- Everything shown in the preview and impact tabs is rendered from A2UI.
  Never hardcode a tile's layout in React.
- VDS (`@shadab5114/pds-core`) is required only for what the A2UI renderer
  renders (the composition/tile itself — `src/a2ui/renderer`). The rest of
  the chrome (picker, chat, preview toolbar, layout, Studio forms) is plain
  modular React + CSS Modules, free-form — not bound to pds-core's component
  API. Reusing `@shadab5114/pdesign-tokens` CSS variables in that chrome is
  styling, not a component dependency, and is fine.
- TypeScript strict. No `any` except the opaque A2UIDocument type.
- Use the exact terms from docs/PLAN.md's Key concepts table (composition,
  slot, mapping, task, version, saved version).
- Work one milestone at a time. Finish with its acceptance criteria checked
  and tests passing, then stop and summarize.
- Ask before adding a dependency not listed in the plan's Stack table.

## VDS package
The plan's "VDS" component library is `@shadab5114/pds-core`, published on
GitHub Packages (not the public npm registry), installed via a scoped registry
entry in the project's `.npmrc`:

```
@shadab5114:registry=https://npm.pkg.github.com
```

The auth token lives only in the developer's global `~/.npmrc` (gitignored,
never committed, never in project `.npmrc`). A 404/401 on `@shadab5114/*`
means the developer needs a GitHub PAT with `read:packages` there:

```
//npm.pkg.github.com/:_authToken=<token>
```

`pds-core` ships `catalog.json` — a machine-readable catalog of every component
(props schema, etc.) in what is already an A2UI-shaped format. The renderer's
registry (`src/a2ui/renderer`) is built against this catalog, never against
hand-guessed props. `unevaluatedProperties: false` on every component entry
means an extra or misnamed prop fails validation.

Theming: `pds-core`'s CSS reads hundreds of `var(--pdesign-*)` custom properties
but never defines them. `@shadab5114/pdesign-tokens` is the token source —
install it alongside and import its CSS before/alongside pds-core's, or
components render structurally unstyled. There is no `ThemeProvider`; styling is
per component via a `surface`/`background` string prop.

## A2UI spec (v0.9)
There is no published A2UI renderer package — pds-core ships only the catalog,
not a runtime. **`src/a2ui/renderer` is built from scratch** as a registry
renderer driven by `catalog.json`.

**`A2UIDocument` is the real A2UI v0.9 wire envelope**, confirmed against
production examples; `src/a2ui/types.ts` has the full definitions. This is what
`Version.a2ui` stores, what the JSON view and Copy show verbatim, and what
`MockAgentClient` emits as its `result` event — the same shape a real agent
produces, so swapping the agent needs no UI-side translation.

```json
{
  "meta": {
    "provider": "mock", "model": "experience-playground-mock-agent",
    "catalogId": "https://pdesign.dev/catalog/v1/catalog.json",
    "components": ["TileContainer", "Stack", "Badge", "Text"],
    "generatedAt": "2026-10-03T10:00:00.000Z"
  },
  "a2ui": [
    { "version": "v0.9", "createSurface": { "surfaceId": "main", "catalogId": "<catalog.json's catalogId>" } },
    { "version": "v0.9", "updateDataModel": { "surfaceId": "main", "path": "/", "value": { "plan": { "name": "Basic Plan" } } } },
    { "version": "v0.9", "updateComponents": { "surfaceId": "main", "components": [
      { "id": "root", "component": "Stack", "direction": "column", "children": ["title"] },
      { "id": "title", "component": "Text", "children": { "path": "/plan/name" } }
    ] } }
  ]
}
```

- `meta` is this app's own header (provider/model/catalogId/components-used/
  generatedAt) — not part of the core spec, but a production-realistic
  convention. It is optional; documents without it are valid.
- Three message kinds: `createSurface` (no `root` field in v0.9),
  `updateDataModel` (`path` is a JSON Pointer, `"/"` replaces the whole model,
  the key is `value` not `contents`), `updateComponents` (flat component
  **array**, exactly one `id: "root"`, no `componentType`/`properties` wrapper —
  props sit inline next to `component`). This app's own documents always carry
  exactly one of each (a self-contained snapshot per version — a `result` event
  always carries the whole new document, never a patch), but `resolveSurface()`
  handles the general streamed case too (multiple messages, later ones winning).
- **Binding paths.** A path starting with `/` is absolute, resolved from the
  surface's root data model. A path with **no leading slash** is relative to the
  current binding context — the root data model by default, or the current item
  while inside a list-template, **at any nesting depth** (a template nested
  inside another template's item is relative to its own immediate item, not the
  outermost one). See `resolvePath` in `src/a2ui/renderer/resolveValue.ts`.
- Static children: `"children": ["id1","id2"]` — direct siblings that inherit
  the parent's binding context unchanged (they are structural, not per-item).
  List-template children: `"children": { "path": "items", "componentId": "itemTile" }`
  — `path` resolves against the *current* context per the rule above, then the
  template renders once per item, with that item as the new context inside it.
- Object-shaped props nest a DynamicString, e.g. `"title": { "children": "Some text" }`.

**Rendering.** `A2UIRenderer` does not walk the raw message array.
`resolveSurface()` (`src/a2ui/resolveSurface.ts`) merges a document's messages
into one `{ surfaceId, catalogId, dataModel, componentsById }` — `componentsById`
is a `Map`, an internal lookup convenience only; it is never what is stored or
shown to the user.

**Patching (the mock agent).** RFC 6902 JSON Patch cannot address a flat array
by id sensibly, so `MockAgentClient` does not patch the wire document directly.
It resolves the current version via `resolveSurface()`, patches a flat
`{ dataModel, components: Record<id, node> }` shape (what
`src/mocks/scenarios/*.json` patches target — `/components/badge/backgroundColor`),
then re-encodes into a fresh self-contained wire document via `toWireDocument()`.
Scenario files do not need to know the stored format is an array.

**Fixture shape.** `src/mocks/compositions/*.json` are genuine multi-component
compositions, not one component's nested prop tree: `root` (`TileContainer` —
the card chrome: background/padding/borderRadius/dropShadow; `Stack` has none of
that) → `content` (`Stack`, `direction: "column"` — real flexbox) → independent
sibling nodes `badge` (`Badge`) and `eyebrow`/`title`/`subtitle` (plain `Text`).
Scenario patches address these as top-level nodes
(`/components/badge/backgroundColor`, `/components/subtitle/children`). New
scenarios must patch accordingly.

`ChildList` resolution (`resolveChildList` in `A2UIRenderer.tsx`) and the
relative-path rule are covered by `A2UIRenderer.childlist.test.tsx` — static
list, dynamic template list, a nested template relative to its own item, and a
regression check that unknown components still fall back to the "Unsupported
component" box.

## Impact pages: slot hosting
`docs/decisions/impact-pages-slot-hosting.md` has the full decision: a
composition placed into a page is its own independent A2UI surface hosted inside
a `Slot` placeholder — **never** merged into the page document (no id prefixing,
no data-path rewriting). This replaced the plan's original "page composer" merge.

- `SurfaceRegistryContext.ts` + `SurfaceRegistry.tsx` + `useSurfaceDocument.ts`
  hold a `Map<surfaceId, A2UIDocument>` via React context. Safe to leave
  unprovided — `Slot` degrades to its empty-state box, nothing throws.
- `A2UIRenderer` takes `document` **or** `surfaceId` (registry-sourced). A
  `{ component: "Slot", slotId }` node is checked *before* any catalog lookup
  (`Slot` is playground-native, not a VDS component); the target is derived as
  `slot:<pageId>:<slotId>` from the enclosing page's surfaceId (`page:<pageId>`)
  and rendered as its own fully independent `A2UIRenderer`. Shows
  `"Empty slot: <slotId>"` with no page context or nothing registered.
- `src/a2ui/rekeySurface.ts` — `rekeySurface(messages, newSurfaceId)` rewrites
  only the `surfaceId` field on every message kind, plus
  `pageSurfaceId(id)`/`slotSurfaceId(pageId, slotId)` convention helpers.
- Page fixtures `src/mocks/pages/{pdp,aal,order-summary}-mock.json` each have one
  `Slot` (`slotId: "plan-summary"`, the same id across all three). Their own
  authored `surfaceId` is `"main"`; they are rekeyed to `page:<id>` at load time,
  exactly as compositions are. Never author a `page:` surfaceId.
- `src/mocks/mappings.json` places `basic-plan-tile` in PDP, AAL and Order
  Summary (the last with `variant: "compact"`, which styles the slot wrapper only,
  via `ImpactsView.module.css`). Compositions with no mapping do not get the
  "View impacts" toolbar button.
- `ImpactsView.tsx` renders tabs in mapping order as
  `A2UIRenderer surfaceId="page:<id>"` inside a `SurfaceRegistryProvider` whose
  registry is rebuilt (`useMemo`) from the current version whenever it changes:
  every mapped page's `page:` entry plus every placement's `slot:` entry. So a
  prompt on an impact tab updates that tab's slot in place with no tab change,
  and switching tabs needs no refetch.
- Slot wrapper: `SlotNode` always renders a stable `.a2ui-slot-host` div +
  `.a2ui-slot-label` span (`src/index.css` hides the label by default);
  `ImpactsView.module.css` reveals them with the dashed outline and "Updated
  tile" tag. Real DOM text, not a `::before`, on purpose — pseudo-element text is
  invisible to accessibility trees and text-based tests.
- Copy JSON and the JSON view always show the composition's own messages, never
  the page's.
- **Not built:** action-logging inside impact previews (step 7 of that doc).
  Nothing fires renderer actions yet, so there is nothing to log.

## Build state
Built as one vertical slice rather than strict M1→M4 order (by explicit request):
the A2UI renderer and tile fixtures (M1), two-pane shell + picker (M2), chat +
MockAgentClient with all 6 demo-scenario behaviors (M3), the preview toolbar —
versions, undo/redo, status pill, Save to localStorage, JSON view, Copy (M4) —
and the Impacts view (M5). The remote backend and the Studio (S1–S8) are built.

**Not built:** the leave-task unsaved-changes warning, the dev panel, and the
native tab-close prompt (M6); optimistic locking (plan Q3).

## Authoring UI (Studio)
Plan: `docs/AUTHORING_UI_PLAN.md`. The Studio lets people create and edit content
in the UI instead of editing seed files, with Postgres as the single source of
truth. **It is hidden in mock mode** — it writes to Postgres and has no mock
equivalent. Open it at `#/studio` (header toggle). All of S1–S8 is built.

- **Sample import is insert-only.** `server/adapters/postgres/samples.ts`
  (`importSamples`, script `npm run db:samples`) makes every statement
  `on conflict do nothing`. The exact guarantee: `do nothing` protects rows that
  **exist**, so deleting a *sample* row and re-importing brings it back — that is
  what re-importing means. Authored rows the importer never knew about stay deleted.
- **Two write invariants.** Derived columns (`components_used`, a page's `slots`)
  come from the document and never from the caller. `origin` is set on insert and
  **never touched on update** — it records where a row came from, not whether
  anyone edited it. `documentComponents`/`documentSlots` live in
  `server/packages/core/src/document.ts`.
- Routes live under `/v1/authoring/*` (`apps/service/src/http/authoring.ts`),
  mounted only when `AppDeps.authoring` is supplied. `POST /validate` takes
  `a2ui` as `unknown` on purpose — the validator is defensive and an envelope
  finding beats a schema rejection while someone is mid-paste. A `PUT` is 400 for
  a malformed request and 422 (with findings) for a document that fails
  validation; nothing failing validation is stored. Write routes call
  `withListCache.invalidate()`.
- `studioStore.editor` is a discriminated union (`kind: 'composition' | 'page'`),
  so both share one JSON pane, preview, validation and save path —
  `EditorPanels` and `editorDocument.ts` hold what they share.
- A page's **slots are derived from its `Slot` nodes and shown read-only**; the
  client never sends `slots`. Validation runs with `kind: 'page'`, which is what
  lets `Slot` through.
- `type` is not a curated list: the Studio derives the options from the types
  already in use and lets any new one be named, and the agent reads the same
  vocabulary from the same column (`CompositionStore.types()`), so a type
  authored here is never invisible to the model. `pack.json`'s `compositionTypes`
  is only a seed for an empty database.
- The mappings builder (`MappingsSection.tsx`) is page-centric because a page's
  slots are the constraint: a composition can only go where a `Slot` node already
  exists. Its preview reuses the Impacts machinery exactly (`rekeySurface` +
  `pageSurfaceId`/`slotSurfaceId` + `SurfaceRegistryProvider`). Two things worth
  knowing: the placements primary key includes `composition_id`, so changing
  which composition sits in a slot is a remove plus an add, not an update; and a
  slot hosts exactly one surface, so when a slot holds several placements only
  the lowest-position one renders and the UI says so.
- **Authored prose reaches the model.** `CompositionDetail` carries
  `family`/`description`/`agentRules` (defaulted, so an older response still
  parses), `store.get` selects them, `route` puts the record it already fetched
  on `AgentState.composition`, and `generate` appends the rules **after** the
  retrieved guidelines — most specific last. Rules steer the model and are
  deliberately not validator-enforced, which is why the prompt is the only place
  they take effect. The repair node does not see them: it only fixes validation
  errors, and rules are not validated.
- **Flows were removed** (migration `004_drop_flows.sql`). The model is
  **Page -> Compositions**, with placements as the only mapping. Impacts tabs are
  keyed and labelled by page, which also fixed a flow with two pages making all
  but the first unreachable. `Placement` carries `pageName`.

Decisions worth knowing before touching this:
- `composition_versions.saved_by` is `"studio"` for UI saves and `"agent"` for
  agent saves. Required at every call site, never defaulted.
- Deletes are hard deletes. The confirm dialog must name what cascades and say
  whether a re-import can restore the record — see `CascadeWarning` in
  `StudioView.tsx`.
- Authored records inherit `a2ui_version` from `pack.json`; nobody is asked.

Two editor rules that are easy to get wrong, both found by the e2e walkthrough:
- `editor.parsed` is the document the **current text** parses to, `null` while
  the text is broken. Validate and Save read only that. `editor.lastGood` is a
  separate field the preview falls back to, so a half-typed edit does not blank
  the tile. Saving `lastGood` would store a document the person cannot see.
- Every `editor` update uses the functional `set((state) => …)` form. Spreading a
  captured `editor` clobbers whatever landed concurrently (the history panel
  loads while validation is in flight).

Cache invalidation the Studio must do, or a save looks like it failed:
- The playground caches its picker list client-side, so Studio writes call
  `useTaskStore.getState().invalidateExperiences()`, and `LeftPane` loads the
  list on mount. Without both, a tile authored in the Studio is missing from the
  picker until a full reload.
- A placement change calls `useTaskStore.getState().reloadMapping()`, or a new
  Impacts tab only appears after reopening the task.
- `RemoteRepository.getMapping` always overwrites its page-template cache rather
  than keeping the first copy, so a page edited in the Studio is not stale for
  the rest of the session.

`tests/e2e/studio-{walk,pages,mappings}.spec.ts` drive the round trips and skip
themselves when no backend answers on 8787. They create records and clean up
after themselves — Playwright's `request` fixture is test-scoped and unavailable
in `afterAll`, so the cleanup there uses plain `fetch`.

Two traps when adding an agent state field: the LangGraph adapter declares a
channel per field (`GraphState` in `adapters/langgraph/src/index.ts`) and
`withListCache` forwards `CompositionStore` methods by hand — miss either and
the field or method is silently dropped with no type error.

## Stale-process gotchas (both cost hours)
- A dev server left running from an earlier `npm run dev` keeps serving Vite's
  *old* pre-bundled deps even after `npm install` upgrades a package, and
  Playwright's `reuseExistingServer: true` (local, non-CI) will happily reuse it.
  You then see real components mis-reported as "Unsupported component" for no
  apparent reason. If a pds-core upgrade does not seem to take effect, check
  `netstat` for a listener on 5173 first, kill it, and clear `node_modules/.vite`
  before trusting a negative result.
- A `npm run server:start` left running keeps port 8787 and goes on serving the
  *old* code; the new `server:start` fails with `EADDRINUSE` in the background
  and the routes you just added answer 404. If a new route 404s, check
  `netstat -ano | grep 8787` for a lingering listener before debugging the route.

## Working practices for this repo
- Do not run `git commit` unless the user explicitly asks for it in that
  turn. Build and verify (typecheck/lint/test/e2e), then stop and report —
  committing is the user's call, not a milestone-completion default.

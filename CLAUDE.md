# Experience Playground

A two-pane workspace where designers pick a VDS experience, prompt an agent to
change it, and see the result rendered from A2UI JSON, including its impact on
the real pages where it appears. Full plan: docs/PLAN.md. Read it before any task.

## Repo map
- Playground: repo root (src/, tests/). Plan: docs/PLAN.md.
- Backend: server/ (Bun + Hono + Postgres). Plan: docs/BACKEND_PLAN.md.
  Rules: server/CLAUDE.md. Backend paths in the plan are relative to server/.
- Shared contract: server/packages/contract (AgentRequest, AgentEvent, composition
  types). Both the playground and the backend import it; do not duplicate these types.
- Backend code lives only in server/.

## Phase 1 rules
- Mock is the default; remote mode talks to the Experience Agent backend.
  Mock: all agent behavior comes from scenario JSON in src/mocks/scenarios.
  Remote: set VITE_DATA_SOURCE=remote and run the backend in server/ (see Repo map).
- The UI talks to two interfaces only: AgentClient and Repository
  (src/services). Only the task store calls them.
- Everything shown in the preview and impact tabs is rendered from A2UI.
  Never hardcode a tile's layout in React.
- VDS (`@shadab5114/pds-core`) is required only for what the A2UI renderer
  renders (the composition/tile itself — `src/a2ui/renderer`). The rest of
  the chrome (picker, chat, preview toolbar, layout) is plain modular
  React + CSS Modules, free-form — not bound to pds-core's component API.
  It's fine to reuse `@shadab5114/pdesign-tokens` CSS variables in that
  chrome for visual consistency; that's styling, not a component dependency.
- TypeScript strict. No `any` except the opaque A2UIDocument type.
- Use the exact terms from the Key concepts table (composition, slot, mapping,
  task, version, saved version).
- Work one milestone at a time. Finish with its acceptance criteria checked
  and tests passing, then stop and summarize.
- Ask before adding a dependency not listed in the plan's Stack table.

## VDS package (resolved open question)
The plan's "VDS" component library is `@shadab5114/pds-core`, published on
GitHub Packages (not the public npm registry). It is installed via a scoped
registry entry:

```
@shadab5114:registry=https://npm.pkg.github.com
```

This line lives in the project's `.npmrc`. The auth token itself lives only in
the developer's global `~/.npmrc` (gitignored, never committed, never put in
project `.npmrc`). If `npm install` fails with 404/401 on `@shadab5114/*`, the
developer needs to add a GitHub PAT with `read:packages` scope to their global
`~/.npmrc`:

```
//npm.pkg.github.com/:_authToken=<token>
```

`@shadab5114/pds-core` ships `catalog.json` — a machine-readable catalog of
every component (props schema, etc.) in what is already an A2UI-shaped
format. The A2UI renderer's registry (`src/a2ui/renderer`) should be built
against this catalog rather than guessing component props by hand.

Theming note: `pds-core`'s CSS reads hundreds of `var(--pdesign-*)` custom
properties but never defines them. The companion package
`@shadab5114/pdesign-tokens` is the token source — install it alongside
`pds-core` and import its CSS before/alongside `pds-core`'s, or components
render structurally unstyled. No `ThemeProvider` exists; styling is per
component via a `surface`/`background` string prop.

## A2UI spec (resolved: v0.9, no renderer package exists)
There is no published `@shadab5114/a2ui*` renderer package — `pds-core` ships
only the catalog, not a runtime. **`src/a2ui/renderer` is built from
scratch** as a registry renderer per the plan's fallback, driven by
`pds-core/catalog.json`.

**`A2UIDocument` is the real A2UI v0.9 wire envelope, not an invented
shortcut.** Confirmed against actual production examples (a real agent's
output, provided 2026-10-03) — `src/a2ui/types.ts` has the full type
definitions. This is what `Version.a2ui` stores, what the JSON view and Copy
show verbatim, and what `MockAgentClient` emits as its `result` event — the
same shape a real Experience Agent would produce, so swapping the agent
truly shouldn't need any UI-side translation.

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
  generatedAt) — not part of the core A2UI spec, but a reasonable
  production-realistic convention (a real agent would want to log which
  model produced a given surface too).
- Three message kinds: `createSurface` (no `root` field in v0.9), `updateDataModel`
  (`path` is a JSON Pointer, `"/"` replaces the whole model, key is `value` not
  `contents`), `updateComponents` (flat component **array**, exactly one
  `id: "root"`, no `componentType`/`properties` wrapper — props sit inline
  next to `component`). This app's own documents always carry exactly one of
  each (a self-contained snapshot per version — "a `result` event always
  carries the whole new A2UI document, never a patch"), but
  `resolveSurface()` (below) handles the fully general streamed case too
  (multiple messages, later ones winning), since a real agent could do that.
- **Binding path resolution — absolute vs. relative, confirmed against real
  examples.** A path starting with `/` is always absolute, resolved from the
  surface's root data model (`{ "path": "/plan/name" }`). A path with **no
  leading slash** is relative to the *current binding context* —the root
  data model by default, or the current item while inside a list-template,
  **at any nesting depth** (a template nested inside another template's item
  is relative to its own immediate item, not the outermost one — confirmed
  this is the intended rule, not just an artifact, even though the one real
  example available hardcoded an absolute index for a nested list). See
  `resolvePath` in `src/a2ui/renderer/resolveValue.ts`.
- Static children: `"children": ["id1","id2"]` — direct siblings, inherit
  the parent's current binding context unchanged (they're structural, not
  per-item). List-template children (collections):
  `"children": { "path": "items", "componentId": "itemTile" }` — `path`
  itself resolves against the *current* context per the rule above, then the
  template is rendered once per item, with that item as the new context for
  everything inside it.
- Object-shaped props nest a DynamicString, e.g. `"title": { "children": "Some text" }`.
- Resolve the real `catalogId` and per-component prop schemas from
  `@shadab5114/pds-core/catalog.json` rather than assuming — `unevaluatedProperties: false`
  on every component entry means an extra/misnamed prop fails validation.

**Rendering**: `A2UIRenderer` doesn't walk the raw message array directly.
`resolveSurface()` (`src/a2ui/resolveSurface.ts`) first merges a document's
messages into one `{ surfaceId, catalogId, dataModel, componentsById }` —
`componentsById` is a `Map`, not the wire array, purely as an internal
rendering/lookup convenience; it's never what's stored or shown to the user.

**Patching (the mock agent)**: RFC 6902 JSON Patch can't address a flat
array by id sensibly, so `MockAgentClient` doesn't patch the wire document
directly. It resolves the current version via `resolveSurface()`, patches a
flat `{ dataModel, components: Record<id, node> }` shape (this is what
`src/mocks/scenarios/*.json`'s patches actually target —
`/components/badge/backgroundColor` etc.), then re-encodes the patched
result into a fresh self-contained wire document via `toWireDocument()`
(`src/a2ui/toWireDocument.ts`) for the new version. Scenario files don't
need to know or care that the stored format is an array under the hood.

**History, for context on why the fixtures look the way they do.** Early on
(pds-core 1.0.0-alpha.8), no component in `catalog.json` used the
`ChildList` $def at all — composition only happened through nested prop
objects (`Tilelet.title`/`.badge`/`.image`), so the three tile fixtures were
a single `Tilelet` root node with everything as nested props. alpha.9 added
`Stack`, a genuine flexbox primitive, but its catalog entry still typed
`children` as `DynamicString` (text-only) — a generator gap true of every
component at the time. **alpha.10 fixed the generator**: 10 components now
correctly use `$ref: "#/$defs/ChildList"` for `children` — `Stack`,
`TileContainer`, `ComposableTileContainer`, `AccordionItem`,
`CheckboxGroup`, `RadioButtonGroup`, `ListGroup`, `RadioBoxGroup`, `Modal`,
`Notification`.

**Current state (pds-core 1.0.0-alpha.10): the three tile fixtures were
rebuilt around this.** `src/mocks/compositions/*.json` are now `root`
(`TileContainer` — the card chrome: background/padding/borderRadius/
dropShadow; `Stack` has none of that) → `content` (`Stack`, `direction:
"column"` — real flexbox layout) → independent sibling nodes: `badge`
(`Badge`), `eyebrow`/`title`/`subtitle` (plain `Text`, not
`TitleLockup*`/nested `Tilelet` props). This is genuine multi-component
composition, not one component's nested prop tree. The scenario patches in
`src/mocks/scenarios/*.json` address these as top-level nodes —
`/components/badge/backgroundColor`, `/components/subtitle/children` — not
`/components/root/badge/...` like the old Tilelet-nested version. If you add
a new scenario, patch paths accordingly.

`ChildList` resolution (`resolveChildList` in `A2UIRenderer.tsx`) and the
relative-path rule above are covered by
`src/a2ui/renderer/A2UIRenderer.childlist.test.tsx` — static list, dynamic
template list, a **nested** template whose path is relative to its own
item (not the outer item or the root — the specific thing the "one real
example hardcoded an index" ambiguity was about), and a regression check
that unknown components still fall back to the "Unsupported component" box.
Also exercised for real by the three tile fixtures plus the cap-color /
smaller-badge / highlight-price-difference scenarios end to end.

## Impact pages: slot hosting — groundwork laid, UI not built
`docs/decisions/impact-pages-slot-hosting.md` has the full decision
(verbatim, 2026-10-03): a composition placed into a page is its own
independent A2UI surface hosted inside a `Slot` placeholder — **never**
merged into the page document (no id prefixing, no data-path rewriting).
This replaces the plan's original "page composer" merge approach.

**Built now** (steps 1–3 of that doc, since they're foundational to the
renderer and touched the same code as the wire-format migration above):
- `src/a2ui/renderer/SurfaceRegistryContext.ts` + `SurfaceRegistry.tsx` +
  `useSurfaceDocument.ts` — a `Map<surfaceId, A2UIDocument>` via React
  context. Nothing populates it yet; safe to leave unprovided (`Slot`
  degrades to its empty-state box, nothing throws).
- `A2UIRenderer` takes `document` **or** `surfaceId` (registry-sourced).
  Hitting a `{ component: "Slot", slotId }` node (checked *before* any
  catalog lookup — `Slot` is playground-native, not a VDS component) derives
  the target as `slot:<pageId>:<slotId>` from the enclosing page's own
  surfaceId (`page:<pageId>`) and renders whatever's registered there as its
  own, fully independent `A2UIRenderer`. Shows `"Empty slot: <slotId>"` when
  there's no page context to derive from, or nothing's registered yet.
- `src/a2ui/rekeySurface.ts` — `rekeySurface(messages, newSurfaceId)`
  (rewrites only the `surfaceId` field on every message kind) plus
  `pageSurfaceId(id)`/`slotSurfaceId(pageId, slotId)` convention helpers.
  Unit tested in `rekeySurface.test.ts`.

**Now built too** (steps 4–8): the Impacts view itself, visible in the app.
- Page template fixtures `src/mocks/pages/{pdp,aal,order-summary}-mock.json`
  — real wire-format docs, each with one `Slot` (`slotId: "plan-summary"`,
  same slotId across all three, per step 8). Note: the page fixtures' own
  `surfaceId` is `"main"` too — they're rekeyed to `page:<id>` at load time
  just like compositions are, never authored that way.
- `src/mocks/mappings.json` — `basic-plan-tile` appears in PDP, AAL and
  Order Summary (the last one with `variant: "compact"`, which styles the
  slot wrapper only, via `ImpactsView.module.css`). Other compositions have
  no mapping, so the "View impacts" toolbar button doesn't appear for them.
- `Repository.getMapping`/`getPageTemplate` are real (fixture-backed).
  `pickExperience` in the task store fetches them once alongside the task
  (only the store calls Repository — `ImpactsView` reads `mapping`/
  `pageTemplatesById` from the store).
- `src/features/impacts/ImpactsView.tsx` — tabs in mapping order, renders
  `A2UIRenderer surfaceId="page:<id>"` inside a `SurfaceRegistryProvider`
  whose registry is rebuilt (`useMemo`) from the current version each time
  it changes: every mapped page's `page:` entry (rekeyed page document) plus
  every placement's `slot:` entry (current version, rekeyed). So a prompt on
  an impact tab updates that tab's slot in place with no tab change, and
  switching tabs needs no refetch.
- Slot wrapper: `SlotNode` always renders a stable `.a2ui-slot-host` div +
  `.a2ui-slot-label` span (`src/index.css` hides the label by default);
  `ImpactsView.module.css` reveals them with the dashed outline and
  "Updated tile" tag. Real DOM text, not a `::before`, on purpose — pseudo-
  element text is invisible to accessibility trees and text-based tests.
- Toolbar: `View impacts` icon toggles `view.mode` between `'impacts'` and
  `'preview'` (only shown when the composition has mappings). Copy JSON and
  the JSON view still always show the composition's own messages, never the
  page's.

**Not built** (step 7 only): action-logging inside impact previews. Nothing
fires renderer actions yet, so there's nothing to log.

**Gotcha hit while verifying this**: a dev server left running from an
earlier `npm run dev` session will keep serving Vite's *old* pre-bundled
deps even after `npm install` upgrades a package — Playwright's
`reuseExistingServer: true` (local, non-CI) will happily reuse that stale
server and you'll see real components mis-reported as "Unsupported
component" for no apparent reason. If a pds-core upgrade doesn't seem to
take effect, check `netstat` for a lingering listener on 5173 first, kill
it, and clear `node_modules/.vite` before trusting a negative result.

**The same trap has a backend half.** A `npm run server:start` left running
from an earlier session keeps port 8787 and goes on serving the *old* code; a
new `server:start` fails with `EADDRINUSE` in the background and the routes you
just added answer 404 for no apparent reason. If a new route 404s, check
`netstat -ano | grep 8787` for a lingering listener before debugging the route.

## Progress vs. the plan's milestones (read this before assuming scope)
Built so far, as one vertical slice rather than strict M1→M2→M3→M4 order (by
explicit request): the A2UI renderer + Basic Plan/Home Plan/Order Summary
tile fixtures (M1, minus the 3 page templates/mapping — Impacts is still
untouched), the two-pane shell + picker (M2), chat + MockAgentClient with
all 6 demo-scenario behaviors (M3), and most of the preview toolbar —
versions, undo/redo, status pill, Save to localStorage, JSON view, Copy
(M4). All verified working end-to-end via a manual Playwright walkthrough
(not committed — see `tests/e2e/app-shell.spec.ts` for the one permanent spec).

Also built since (M5): the Impacts view — see "Impact pages: slot hosting"
above. **Not built yet**: the leave-task unsaved-changes warning, the dev
panel, and native tab-close prompt (M6).

## Authoring UI (Studio) — S1–S5 built, remote-only
Full plan and build order: `docs/AUTHORING_UI_PLAN.md`. The Studio lets people
create and edit content in the UI instead of editing seed files, with Postgres
as the single source of truth. **It is hidden in mock mode** — it writes to
Postgres and has no mock equivalent. Open it at `#/studio` (header toggle).

Built (S1–S5):
- **S1** Seed → insert-only sample import. `server/adapters/postgres/seed.ts`
  is now `samples.ts` (`seedPack` → `importSamples`), every statement
  `on conflict do nothing`, and the script is `npm run db:samples`, not
  `db:seed`. Migration `003_authoring.sql` adds `agent_rules`/`origin` to
  compositions, `description`/`agent_rules`/`origin` to page templates, and
  `on delete cascade` to placements and `composition_versions`.
  Exact guarantee: `do nothing` protects rows that **exist**, so deleting a
  *sample* row and re-importing brings it back — that is what re-importing
  means. Authored rows the importer never knew about stay deleted.
- **S2** `AuthoringStore` port (`packages/core/src/ports.ts`) + the Postgres
  implementation (`adapters/postgres/authoring.ts`) + writable contract shapes
  (`packages/contract/src/authoring.ts`). Two invariants every write holds:
  derived columns (`components_used`, a page's `slots`) come from the document
  and never from the caller, and `origin` is set on insert and **never touched
  on update** — it records where a row came from, not whether anyone edited it.
  `documentComponents`/`documentSlots` moved to `packages/core/src/document.ts`.
- **S3** Routes under `/v1/authoring/*` (`apps/service/src/http/authoring.ts`),
  mounted only when `AppDeps.authoring` is supplied. `POST /validate` takes
  `a2ui` as `unknown` on purpose — the validator is defensive and an envelope
  finding beats a schema rejection while someone is mid-paste. A `PUT` is 400
  for a malformed request and 422 (with findings) for a document that fails
  validation; nothing failing validation is stored. `withListCache` gained
  `invalidate()`, which the write routes call.
- **S4/S5** The Studio UI: a ~60-line hash router (`src/app/useHashRoute.ts`,
  no new dependency), `AuthoringRepository` + `RemoteAuthoringRepository`,
  `src/features/studio/studioStore.ts` (only this store calls the repository),
  form primitives in `src/components/forms/`, and the composition editor —
  metadata, JSON pane, live `A2UIRenderer` preview, live validation, and the
  DERIVED / APPEARS IN / HISTORY panels.
- **S6** The page editor and flows. `studioStore.editor` is a discriminated
  union (`kind: 'composition' | 'page'`) rather than two parallel editors, so
  both share one JSON pane, preview, validation and save path — `EditorPanels`
  and `editorDocument.ts` hold what they share. A page's **slots are derived
  from its `Slot` nodes and shown read-only**; the client never sends `slots`.
  Validation runs with `kind: 'page'`, which is what lets `Slot` through.
  `type` is not a curated list: the Studio derives the options from the types
  already in use and lets any new one be named, and the agent reads the same
  vocabulary from the same column (`CompositionStore.types()`), so a type
  authored here is never invisible to the model. `pack.json`'s
  `compositionTypes` is only a seed for an empty database now.
  Flows can be created, renamed and — only while no page uses one — removed:
  `page_templates.flow_id` is a NOT NULL foreign key with no cascade, so
  `DELETE /v1/authoring/flows/:id` answers 409 with the page count rather than
  letting a constraint violation surface as a 500.

- **S7** The mappings builder (`MappingsSection.tsx`), page-centric because a
  page's slots are the constraint: a composition can only go where a `Slot`
  node already exists. The preview reuses the Impacts view's machinery exactly
  — `rekeySurface` + `pageSurfaceId`/`slotSurfaceId` + `SurfaceRegistryProvider`,
  documents hosted independently and never merged. Two things worth knowing:
  the placements primary key includes `composition_id`, so changing which
  composition sits in a slot is a remove plus an add, not an update; and a slot
  hosts exactly one surface, so when a slot holds several placements only the
  lowest-position one renders and the UI says so.

- **S8** Authored prose reaches the model. `CompositionDetail` now carries
  `family`/`description`/`agentRules` (defaulted, so an older response still
  parses), `store.get` selects them, `route` puts the record it already fetched
  on `AgentState.composition`, and `generate` appends the rules **after** the
  retrieved guidelines — most specific last. Rules steer the model and are
  deliberately not validator-enforced, which is why the prompt is the only
  place they can take effect. `description` already reached the model through
  the `find` node's disambiguation list and was left alone.

  Two traps when adding a state field: the LangGraph adapter declares a channel
  per field (`GraphState` in `adapters/langgraph/src/index.ts`) and
  `withListCache` forwards `CompositionStore` methods by hand — miss either and
  the field or method is silently dropped with no type error.

**All of S1–S8 is built.** What the plan leaves open: Q3 (optimistic locking)
and the repair node, which does not see a composition's rules — it only fixes
validation errors, and rules are not validated.

Decisions worth knowing before touching this (plan §8):
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
- Every `editor` update uses the functional `set((state) => …)` form. Spreading
  a captured `editor` clobbers whatever landed concurrently (the history panel
  loads while validation is in flight).

The playground caches its picker list client-side, so Studio writes call
`useTaskStore.getState().invalidateExperiences()` and `LeftPane` loads the list
on mount. Without both, a tile authored in the Studio is missing from the
picker until a full reload, which looks exactly like the save having failed.
A placement change calls `useTaskStore.getState().reloadMapping()` for the same
reason — otherwise a new Impacts tab only appears after reopening the task.
`RemoteRepository.getMapping` now always overwrites its page-template cache
rather than keeping the first copy, so a page edited in the Studio is not stale
for the rest of the session.

`tests/e2e/studio-{walk,pages,mappings}.spec.ts` drive the round trips and skip
themselves when no backend answers on 8787. They create records and clean up
after themselves — note that Playwright's `request` fixture is test-scoped and
unavailable in `afterAll`, so the cleanup there uses plain `fetch`.

## Working practices for this repo
- Do not run `git commit` unless the user explicitly asks for it in that
  turn. Build and verify (typecheck/lint/test/e2e), then stop and report —
  committing is the user's call, not a milestone-completion default.

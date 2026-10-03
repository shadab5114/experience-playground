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

## Working practices for this repo
- Do not run `git commit` unless the user explicitly asks for it in that
  turn. Build and verify (typecheck/lint/test/e2e), then stop and report —
  committing is the user's call, not a milestone-completion default.

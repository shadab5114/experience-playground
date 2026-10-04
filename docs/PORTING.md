# Porting the Experience Playground to your org

> A runbook for taking this repo as-is and standing it up on your own design
> system, your own model gateway, your own Postgres and your own RAG app.
> Written 2026-10-04 against pds-core 1.0.0-alpha.11.
>
> Read this file and nothing else to do the port. `docs/PLAN.md`,
> `docs/BACKEND_PLAN.md` and `docs/AUTHORING_UI_PLAN.md` are the original design
> plans — useful background, not needed here, and expensive to read.

## The one idea that makes this portable

**The component catalog is the single source of truth, and almost nothing is
coupled to it.** `catalog.json` supplies the component names, their prop schemas
and the `catalogId`; the renderer, the validator and the agent prompt all derive
from it rather than hardcoding anything.

Concretely, swapping design systems touches **15 lines in 12 files**, plus
content. Everything else — the A2UI wire format, the surface/slot machinery, the
stores, the HTTP routes, the Studio, the LangGraph graph — is design-system
agnostic and should not be edited.

The corollary that drives the whole plan: **change the catalog first and let the
repo's own guards tell you what to fix.** Four commands produce your entire work
list. Do not go looking for work by reading files.

---

## 1. What you must provide

| # | Input | Where it lands | What happens without it |
|---|---|---|---|
| 1 | **Component library package** — name and exact version (installed already) | `package.json`, `server/ds-packs/<pack>/package.json`, `pack.json` | Nothing renders |
| 2 | **Design tokens package** (the CSS custom properties your components read) | `src/main.tsx` | Components render structurally unstyled |
| 3 | **`catalogId`** — read it out of *your* `catalog.json`, never invent it | `server/ds-packs/<pack>/pack.json` | Every document fails envelope validation |
| 4 | **Model access** — base URL, API key, model id | `server/.env` | Remote mode cannot answer a prompt |
| 5 | **Postgres** — one app database, one database whose name contains `test` | `server/.env` | Remote mode and the Studio do not start |
| 6 | **RAG app** — base URL, collection name, optional API key | `server/.env` + `pack.json` | Falls back to a local file stub (fine to defer) |
| 7 | **Design rules** — your must-never list, and the approved badge/cap colors | `server/ds-packs/<pack>/rules.json` + `validator/rules.ts` | The agent produces structurally valid output that breaks your guidelines |
| 8 | **Page templates and mappings** — the real pages your compositions appear on, and which slot each sits in | `src/mocks/pages/`, `seed/page-templates.json`, `seed/placements.json` | The Impacts view has nothing to show |
| 9 | **Composition types** and the A2UI version your docs declare | `pack.json` | Minor; the Studio derives types from what exists |

Items 7 and 8 are the two people forget. They are not optional: item 7 is what
stops the agent shipping off-brand output, and item 8 is the entire reason the
app exists rather than being a JSON editor.

### 1a. The hard requirement on item 1

Your library must ship **four** artifacts. This is the thing that decides whether
the port is a day or a project, so check it before you write any code:

```bash
node scripts/check-catalog.mjs @your-org/your-core
```

| Artifact | Consumed by | What breaks without it |
|---|---|---|
| `catalog.json` — `catalogId` + `components` + `$defs` | renderer, server catalog, agent prompt | Everything |
| A `schemas` entrypoint exporting one `<Name>Schema` (Zod) per component | `server/ds-packs/<pack>/catalog.ts:30` | Server **throws at startup** |
| Every catalog component exported by name from the package root | `src/a2ui/renderer/registry.ts:14` | Renders as "Unsupported component" |
| An `icons` entrypoint, if any component uses `#/$defs/IconName` | `src/a2ui/renderer/icons.tsx` | Icon slots render empty |

**And one non-negotiable naming rule.** Your `catalog.json` `$defs` must reuse
A2UI's canonical names *verbatim*: `DynamicString`, `DynamicBoolean`,
`ChildList`, `IconName`, `ComponentCommon`, `Action`. The renderer branches on
literal `$ref` strings (`isDynamicRef`, `isChildListRef`, `isIconNameRef` in
`src/a2ui/schema.ts`). Rename one and bindings stop resolving **with no error** —
React is handed a raw `{ "path": "/plan/name" }` object as a prop. The preflight
script checks this.

If the preflight fails, **generating those artifacts is the project** and the
rest of this document is the day. pds-core generates `catalog.json` and the Zod
schemas from the component source; reuse your own generator rather than
hand-writing them, because a hand-written catalog drifts from the components it
describes and nothing catches it until a composition renders wrong.

---

## 2. Change this first — the order is not arbitrary

Do these in order. Each step's output is the next step's input, and doing them
out of order means redoing work:

```
A. Inputs & preflight   ──▶  is the library portable at all?
B. Catalog swap         ──▶  the app renders YOUR components
C. Content              ──▶  your tiles, pages, mappings, scenarios
D. Agent                ──▶  rules, guidelines, system prompt
E. Infra                ──▶  Postgres, model, RAG
F. Verify               ──▶  the full loop, end to end
```

The common mistake is starting at C. **You cannot write fixtures for a catalog
you have not wired up yet** — you will not know which components exist, what
their props are called, or which prop is the child list. Phase B first; it is
also the only phase with real design risk.

Phases B and C are the whole port for most teams. D is where the value is. E can
be stubbed throughout (mock mode needs no backend at all).

---

## Phase A — Inputs and preflight

Assumes your component library and tokens package are **already installed** —
registry, auth and `npm install` are yours to sort out before you start here, and
this runbook does not cover them.

1. Fork this repo. Keep the git history; you will want `git log` on the renderer.
2. Confirm the install resolved: `node -p "require('@your-org/your-core/package.json').version"`
3. `node scripts/check-catalog.mjs @your-org/your-core` → must pass before
   Phase B.
4. Record `catalogId` from the preflight output. You will paste it into
   `pack.json` and nowhere else.

**Pin the catalog package to an exact version with no caret, in all three
places** (root `package.json`, the pack's `package.json`, `pack.json`). One repo,
one catalog: the renderer resolves the root copy and the validator resolves the
pack's copy, so a caret lets the server reject a document the renderer draws
fine. `server/ds-packs/vds/validator.test.ts` enforces this — it is a guard, not
a formality.

---

## Phase B — The catalog swap

### B1. Rename the pack (optional but recommended)

If you keep the directory name `vds`, skip this. Otherwise:

```bash
git mv server/ds-packs/vds server/ds-packs/<yourpack>
```

Then update, in this order:

| File | Change |
|---|---|
| `server/ds-packs/<yourpack>/package.json` | `"name": "@experience-agent/<yourpack>-pack"` |
| `server/ds-packs/<yourpack>/pack.json` | `"name": "<yourpack>"` |
| `server/apps/service/src/wire.ts` | the `createVdsCatalog` import **and** the hardcoded `if (config.DS_PACK !== "vds") throw` guard |
| `server/.env.example`, `server/.env` | `DS_PACK=<yourpack>` |
| `server/ds-packs/<yourpack>/catalog.ts` | rename `createVdsCatalog` if you like |

`wire.ts` is the only file that knows which concrete adapters exist. The
`DS_PACK !== "vds"` throw is deliberate — the pack registry is a single `if`,
not a plugin system. Change the string; do not build a loader.

### B2. Point `pack.json` at your catalog

```json
{
  "name": "<yourpack>",
  "a2uiVersion": "v0.9",
  "catalogId": "<the catalogId from YOUR catalog.json, verbatim>",
  "catalogPackage": { "name": "@your-org/your-core", "version": "<exact>" },
  "guidelines": { "collection": "<your RAG collection name>" },
  "compositionTypes": ["<your types>"]
}
```

`catalogId` is checked in two places and both reject a mismatch:
`validator/envelope.ts:40` (a document's `createSurface.catalogId` must equal the
pack's) and `validator/scope.ts:22` (it may not change across an edit).

One surface carries exactly **one** `catalogId`. If you need components from two
libraries, that is a single *pack* whose component map is their union, not two
catalogs — see `docs/adding-a-component-library.md`, which covers that case in
full including the `$defs` scoping trap.

### B3. The 15 import sites

This is the entire code coupling — the complete output of
`grep -rn "@shadab5114" src server package.json .npmrc`. Replace
`@shadab5114/pds-core` with your package and `@shadab5114/pdesign-tokens` with
your tokens package:

| File | Line | What |
|---|---|---|
| `.npmrc` | 1 | `@your-org:registry=...` — already correct if your install resolved |
| `package.json` | 25-26 | both dependencies (exact versions, no caret) |
| `src/a2ui/schema.ts` | 1 | `catalog from '<pkg>/catalog.json'` |
| `src/a2ui/renderer/registry.ts` | 1 | `* as PdsCore from '<pkg>'` |
| `src/a2ui/renderer/icons.tsx` | 2 | `* as PdsIcons from '<pkg>/icons'` |
| `src/a2ui/renderer/icons.test.tsx` | 3 | same |
| `src/icons/index.ts` | 4 | `{ Undo, Redo, Search, Close, Refresh, Check } from '<pkg>/icons'` |
| `src/app/AppHeader.tsx` | 1 | `{ Text } from '<pkg>'` |
| `src/main.tsx` | 3-4 | the two CSS imports |
| `server/ds-packs/<yourpack>/catalog.ts` | 8, 23 | `<pkg>/schemas`, `<pkg>/catalog.json` |
| `server/ds-packs/<yourpack>/pack.json` | 6 | `catalogPackage.name` |
| `server/ds-packs/<yourpack>/package.json` | 9 | the dependency |

Nothing else names the package, and nothing else names the `catalogId`. The
pack's own tests derive both from `pack.json`, so they need no edit — that is
deliberate, so `pack.json` stays the only place the catalog identity is written.
(Two test fixtures, `adapters/postgres/authoring.test.ts` and
`packages/contract/src/contract.test.ts`, still carry the old URL as an
arbitrary string. Neither goes through validation, so they are cosmetic.)


Two of these need judgment, not a find-and-replace:

- **`src/main.tsx`** — import your tokens CSS **before** the component CSS. Your
  components' CSS reads custom properties the tokens package defines; the other
  order renders unstyled. There is no `ThemeProvider`; styling is per component
  via a `surface`/`background` string prop.
- **`src/icons/index.ts` and `src/app/AppHeader.tsx`** — these are *chrome*, not
  the A2UI renderer. The chrome is free-form React + CSS Modules and is not bound
  to your component API. If your library has no `Undo`/`Redo`/`Search`/`Close`/
  `Refresh`/`Check` icon or no `Text`, do not contort it: use your own SVGs (see
  `src/icons/CustomIcons.tsx`, which already does this for the ones pds-core
  lacks) or plain markup. Only `src/a2ui/renderer/*` is required to go through
  your library.

### B4. Let the guards drive

Delete the showcase fixture now — it enumerates every pds-core component and is
100% invalid for your catalog, and it is the single most expensive file in the
repo to read (32 KB, ~9k tokens):

```bash
git rm src/mocks/compositions/catalog-showcase-tile.json \
       src/a2ui/renderer/A2UIRenderer.catalogShowcase.test.tsx
# and remove the "catalog-showcase" entry from src/mocks/experiences.json
```

You will regenerate it in Phase F, when you know your catalog. Now run the four
commands:

```bash
npm run check:catalog -- @your-org/your-core   # the library itself
npm run server:test                            # catalog wiring + validator
npm test                                       # renderer + fixtures
npx tsc -b && npx tsc -p server/tsconfig.json --noEmit
```

Those failures **are** your work list for Phase C. In particular:

| Guard | Failure means |
|---|---|
| `createVdsCatalog()` throws at startup | a catalog component has no `<Name>Schema` export — the library's schema generation is incomplete, not that your merge is wrong |
| `catalog wiring > every catalog component resolves to a schema` | same, caught in tests |
| `validator fixtures > ref-*` fail | structural validation — these are catalog-agnostic A2UI conformance cases. **If these fail, you broke something**; they should pass untouched |
| `validator fixtures > ds-10*` fail | your rules differ. Phase D |
| `seeded documents validate clean` fail | your fixtures use components or props your catalog does not define. Phase C |
| "Unsupported component" in the rendered preview | the name is in `catalog.json` but not exported from the package root |

---

## Phase C — Content

### C1. Compositions and pages

Six documents, each existing **twice on purpose**:

| Document | Mock copy (no backend) | Seed copy (remote mode) |
|---|---|---|
| 3 compositions | `src/mocks/compositions/*.json` | `server/ds-packs/<pack>/seed/compositions.json` |
| 3 page templates | `src/mocks/pages/*.json` | `server/ds-packs/<pack>/seed/page-templates.json` |

Nothing imports across that boundary — the playground must not depend on a
ds-pack — so a test keeps the two copies equal:
`src/a2ui/contractFixtures.test.ts > mock fixtures match the backend seed`. **Edit
one side, run `npm test`, and it names the file you forgot.** Do not relax it.

What a composition looks like, and the shape to copy
(`src/mocks/compositions/basic-plan-tile.json` is the reference):

- `root` — your card chrome component (background, padding, border radius,
  shadow). A flex primitive has none of that; use the container.
- `content` — your flex/stack primitive, `direction: "column"`.
- independent sibling nodes — badge, eyebrow, title, subtitle as **separate
  top-level nodes**, not nested props of one component.

That last point matters more than it looks. These are genuine multi-component
compositions, and the scenario patches in Phase C3 address the nodes by id
(`/components/badge/backgroundColor`). A fixture built as one component's nested
prop tree works for rendering but makes every patch path wrong.

Write the documents against your catalog, not against this one. To see what your
components actually accept, without reading the 233 KB catalog:

```bash
# every component name
node -p "Object.keys(require('@your-org/your-core/catalog.json').components).join(' ')"

# one component's props
node -e "console.log(JSON.stringify(require('@your-org/your-core/catalog.json').components.Badge,null,1))"

# which components take a child list (these are your layout primitives)
node -e "const c=require('@your-org/your-core/catalog.json');console.log(Object.entries(c.components).filter(([,s])=>JSON.stringify(s).includes('#/\$defs/ChildList')).map(([n])=>n).join(' '))"
```

Every page template needs **at least one `Slot` node** — `Slot` is
playground-native, not one of your components, and it is the placeholder a
composition is hosted in. Keep the same `slotId` across pages where the same
composition appears; that is what makes one mapping drive several tabs. Author
the page's own `surfaceId` as `"main"`, exactly like a composition: pages are
rekeyed to `page:<id>` at load time, and authoring a `page:` surfaceId breaks
slot derivation.

### C2. Experiences and mappings

- `src/mocks/experiences.json` — the picker list. One entry per composition.
- `src/mocks/mappings.json` — which pages a composition appears on, and in which
  slot. A composition with no mapping simply gets no "View impacts" button, which
  is correct, not broken.
- `server/ds-packs/<pack>/seed/placements.json` — the remote-mode equivalent.

### C3. Scenarios (mock mode's scripted agent)

`src/mocks/scenarios/*.json` is the whole of mock-mode agent behavior — no code
changes to add one. Files are globbed and **sorted by filename**, first match
wins, which is why they are numbered (`00-` scope notice is checked before the
edits). The schema is `src/mocks/types.ts` (~20 lines; read that, not the client).

Three outcome kinds: `edit` (a JSON Patch + summary), `refusal` (a reason +
alternatives), `scope` (a scope notice). `match` is a list of case-insensitive
regexes tested against the prompt.

Two things to update for your design system:

- **Patch paths** target a flattened `{ dataModel, components: Record<id, node> }`
  shape — `/components/badge/backgroundColor`, `/components/subtitle/children`.
  The ids are your fixture's node ids and the leaf is your prop name.
- **`UNSUPPORTED_ALTERNATIVES`** in `src/services/agent/MockAgentClient.ts` is
  hardcoded VDS-flavored prompt copy ("Change the cap color to red"). It is the
  chips shown when nothing matches, so it should name prompts your scenarios
  actually handle.

Keep at least one of each outcome kind. The refusal and scope-notice paths are
UI states that are otherwise unreachable, and a demo without them does not show
what the app is for.

---

## Phase D — The agent

Mechanical, except the last item, which people skip — and if you skip it,
nothing you built in Phase B or C will ever be used.

### D1. `rules.json` — the must-never list

`server/ds-packs/<pack>/rules.json` currently carries placeholder `DS-101`–`DS-105`
and a `capColors` allowlist. Replace them with your design team's real list.

**The trap:** the rule *implementations* in
`server/packages/core/src/validator/rules.ts` hardcode component and prop names
from pds-core:

| Rule | Hardcoded names |
|---|---|
| DS-101 one primary button | component `Button`, prop `kind` |
| DS-102 inputs need labels | `InputField`, `TextArea`, `CheckboxGroup`, `RadioButtonGroup`, prop `label` |
| DS-103 badges are short | `Badge`, prop `children` |
| DS-104 images have alt | `Image`, prop `alt` |
| DS-105 no literal prices | any prop, regex `[$€£]\s?\d` |
| cap colors | `Badge`, prop `backgroundColor` |

If your catalog names these differently, **the rule silently never fires.** There
is no error: `c.component === "Badge"` is just false forever. Go through that file
component by component and either rename or rewrite each rule, and keep a failing
golden fixture per rule (below) so you can prove each one still bites.

### D2. `guidelines.json` — the file stub

Used whenever `RAG_BASE_URL` is unset, which is most of local development. Shape
is `{ entries: [{ sourceId, component, topic?, text }] }`, filtered by component
name. Put a handful of real passages in here for your components; it is what the
agent reasons from before the RAG app is wired.

### D3. `prompts/system.md` — **the step people skip**

A model that does not know your components exist will never emit them. Your
catalog can be flawless and nothing changes in practice.

The current file is explicitly marked as unreviewed placeholder wording
(`<!-- PLACEHOLDER -->`, which is stripped before the prompt is sent). Rewrite
it for your system, keeping the four structural rules that are not design-system
specific:

- only components and props from the given catalog; never invent a prop
- keep `surfaceId`, the root id and `catalogId` exactly as they are
- change only what the request asks for
- short plain summaries, no describing the JSON

Then add your own domain vocabulary. The existing file's last line is the model
of what to write: *"in a plan tile, the 'cap' is the Badge at the top"* — the
jargon your designers type, mapped to the component and prop it means. That one
sentence is the difference between a prompt that works and one that does not.

### D4. Golden fixtures

| Directory | What it is | Port action |
|---|---|---|
| `golden/validator/ref-*.json` (14) | A2UI structural conformance — catalog-agnostic | **Leave alone.** If these fail you broke the validator |
| `golden/validator/ds-10*.json` (5) | one failing document per design rule | Rewrite to your components, one per rule from D1 |
| `golden/validator/new-*.json` | envelope/scope/slot cases | Mostly catalog-agnostic; fix component names only |
| `golden/graph/*.json` (4) | whole agent runs, prompt → expected document | Rewrite against your fixtures and scenarios |
| seeded documents | validated directly from `seed/*.json` | Nothing to do — no copies to keep in sync |

### D5. Authored rules reach the model

Worth knowing before you wonder where to put design guidance: a composition's
`agent_rules` (set in the Studio) are appended to the prompt **after** the
retrieved guidelines — most specific last. They are deliberately *not*
validator-enforced, so the prompt is the only place they take effect. The repair
node does not see them; it only fixes validation errors.

---

## Phase E — Infrastructure

### E1. Postgres

Two databases: the app database, and one **whose name contains `test`** (the test
harness refuses to touch a database without it — that check is the only thing
between your dev data and a truncating test run).

Either use the bundled Docker Postgres, which creates both:

```bash
npm run db:up        # docker compose, port 5433
```

…or point at your own local or managed instance. Copy `server/.env.example` to
`server/.env` and set:

```
DATABASE_URL=postgres://<user>:<pass>@<host>:<port>/<your_db>
TEST_DATABASE_URL=postgres://<user>:<pass>@<host>:<port>/<your_db>_test
DATABASE_SSL=off          # on + DATABASE_SSL_CA_FILE for RDS/Aurora
```

Then:

```bash
npm run db:migrate   # plain numbered SQL in adapters/postgres/migrations, no ORM
npm run db:samples   # import your seed content
```

Two things about `db:samples` worth internalizing: every statement is
`on conflict do nothing`, so it is safe to re-run; and the guarantee is precisely
*"rows that exist are protected"*. Delete a **sample** row and re-import and it
comes back — that is what re-importing means. Rows you authored in the Studio,
which the importer never knew about, stay deleted.

Migration `004_drop_flows.sql` removed the old `flows` table. The content model
is **Page → Compositions**, with placements as the only mapping. If you see
`flows` anywhere, it is stale.

### E2. Model

```
ANTHROPIC_BASE_URL=https://your-gateway.internal/v1   # or https://api.anthropic.com
ANTHROPIC_API_KEY=<key>
MODEL_ID=claude-sonnet-5-5
MODEL_TIMEOUT_MS=60000
# ANTHROPIC_WORKSPACE_ID=   # only for keys not already scoped to a workspace
```

`ANTHROPIC_API_KEY` and `MODEL_ID` have **no defaults** — the server refuses to
start rather than guessing a model you did not choose, and the config error names
the variable without echoing its value. If your gateway speaks the Anthropic
Messages API, pointing `ANTHROPIC_BASE_URL` at it is the entire change; if it
speaks something else, write a second adapter beside
`server/adapters/anthropic/` and swap one line in `wire.ts`. Core only ever sees
the port, never the SDK.

Keep real keys in `server/.env` only. It is gitignored. **Do not copy this
repo's existing `server/.env` into your fork** — rebuild it from
`server/.env.example`.

### E3. RAG

The agreed contract, which your app must match (or you adapt
`server/adapters/guidelines/src/rag.ts`, ~60 lines):

```
POST {RAG_BASE_URL}/query
  headers:  content-type: application/json
            authorization: Bearer <RAG_API_KEY>    (only when set)
  request:  { "query": "<text>", "collection_name": "<pack.json guidelines.collection>" }
  response: { "answer": "<markdown>" }             (only `answer` is read)
```

```
RAG_BASE_URL=https://your-rag.internal
RAG_API_KEY=<key>
RAG_TIMEOUT_MS=30000
```

Leave `RAG_BASE_URL` **empty** to use the `guidelines.json` file stub. Wire the
real endpoint last: it is the one input you can defer all the way to the end
without blocking anything else.

Because the app returns no document ids, each answer gets a synthetic
`rag-<hash>` source id derived from the query. A refusal can cite it, but it is
not a document id — if your app does return ids, returning them properly is a
small, worthwhile change to `rag.ts`.

### E4. Front end

```
VITE_DATA_SOURCE=mock        # or: remote
VITE_API_BASE_URL=http://localhost:8787
```

Mock mode needs no backend and no database. **Keep it working** — it is how you
demo without infrastructure, and it is what the 138 frontend tests run against.
Remote mode is also the only mode where the Studio appears (it writes to
Postgres and has no mock equivalent); open it at `#/studio`.

---

## Phase F — Verify

```bash
npm run check:catalog -- @your-org/your-core
npm test                      # frontend: renderer, stores, fixtures, drift guard
npm run server:test           # backend: validator, golden fixtures, stores, graph
npx tsc -b
npx tsc -p server/tsconfig.json --noEmit
npm run lint
npm run e2e                   # Playwright; the studio specs skip if nothing answers on 8787
```

Then regenerate the showcase fixture you deleted in B4: one composition that
renders **every** component in your catalog once, plus the test asserting full
coverage. It fails whenever your library adds a component, which is exactly the
guard you want — copy the deleted `A2UIRenderer.catalogShowcase.test.tsx` from
git history and rebuild the fixture against your catalog.

Acceptance — the real test is the loop, not the suite:

- [ ] Preflight passes on your library
- [ ] Mock mode: pick a tile, prompt it, see the edit, undo, view impacts on every mapped page, save
- [ ] Every component in your catalog renders with no "Unsupported component" box
- [ ] A binding resolves; a `ChildList` template renders one node per item
- [ ] Remote mode: the same loop, against Postgres and your model
- [ ] A refusal fires from one of *your* design rules, with real alternatives
- [ ] The Studio creates a composition, a page and a placement, and the new Impacts tab appears without a reload
- [ ] **The agent emits one of your components from a plain prompt** ← the only box that proves the port landed

---

## 3. Driving Claude through this cheaply

The port is mostly mechanical, and the expensive part is letting an agent
rediscover the repo. Four rules:

**Never let it read `catalog.json`.** It is 233 KB — roughly 60k tokens, a third
of a context window, for information three one-line `node -p` commands answer
precisely. The commands are in Phase C1. Put them in your prompt.

**Delete the showcase fixture before you start** (Phase B4). 32 KB that is
guaranteed-invalid for your catalog, and any agent surveying `src/mocks/` will
read it.

**One session per phase, with the file list from this document.** Phases B, C, D
and E barely overlap. A session that is handed "Phase B: these 9 files, here is
my package name and catalogId" does in a few thousand tokens what an
open-ended "port this app" session burns a hundred thousand on.

**Make the guards do the talking.** Instead of asking Claude to find what needs
changing, have it run the four Phase B4 commands and work the failures. The repo
is instrumented for exactly this: missing schema exports throw at startup,
missing components fail the coverage test, mismatched catalogIds fail validation,
and drifted fixtures name the file. That is a precise work list for the cost of
four command outputs.

Two more, specific to this repo:

- `CLAUDE.md` loads into every session. It is the operative rules for the app;
  as you port, delete the sections that no longer describe your fork rather than
  letting it grow.
- Don't point it at `docs/PLAN.md`, `docs/BACKEND_PLAN.md` or
  `docs/AUTHORING_UI_PLAN.md` for the port. They are ~1700 lines of original
  design plans. This file is the port.

---

## 4. The silent failures — read this once

Every expensive bug in this port passes the type checker and most of the test
suite. These are all of them that are known:

| Failure | How it shows up | Guard |
|---|---|---|
| A `$defs` name renamed in your catalog | No error. React receives `{ path: "/..." }` as a prop and renders nothing or `[object Object]` | `scripts/check-catalog.mjs` |
| System prompt never mentions your components | Everything passes; the agent simply never emits them | The last acceptance box |
| `validator/rules.ts` still names pds-core components | Design rules never fire; off-brand output validates clean | One failing golden fixture per rule (D1/D4) |
| Caret on the catalog package | Renderer and validator use different catalogs; the server rejects what the UI drew | The pinned-version test in `validator.test.ts` |
| Fixture edited on one side only | Mock mode and remote mode show different tiles | `contractFixtures.test.ts` drift guard |
| Component in `catalog.json` but not exported from the package root | "Unsupported component" box, no console error | Preflight + the showcase coverage test |
| Page authored with `surfaceId: "page:..."` | Slot never resolves; the tab shows "Empty slot" | None — just don't; author `"main"` |
| Tokens CSS imported after component CSS | Components render structurally unstyled, no error | None — check `src/main.tsx` order |

And the two that cost hours because the code is innocent:

- **A dev server left running** from before an `npm install` keeps serving Vite's
  *old* pre-bundled deps, and Playwright's `reuseExistingServer` happily reuses
  it. Real components then report as "Unsupported component" for no visible
  reason. After any package change: kill the listener on 5173, `rm -rf
  node_modules/.vite`, and only then trust a negative result.
- **A `server:start` left running** keeps port 8787 and serves the *old* code; the
  new one dies with `EADDRINUSE` in the background and your new route 404s. Check
  `netstat -ano | grep 8787` before debugging the route.

---

## 5. What not to change

Everything here is design-system agnostic. Editing it is how a port turns into a
rewrite:

| Keep | Why |
|---|---|
| The A2UI v0.9 wire format and `src/a2ui/types.ts` | It is a spec, not a convention. `CLAUDE.md` documents it |
| `resolveSurface`, `toWireDocument`, `rekeySurface` | Format plumbing; no component names in them |
| The `Slot` / `SurfaceRegistry` hosting model | A composition in a page is an independent surface, never merged. `docs/decisions/impact-pages-slot-hosting.md` has the reasoning |
| `AgentClient` / `Repository` / `AuthoringRepository` | The UI talks to these three interfaces only, and only the stores call them |
| `server/packages/contract` | Shared types; both halves fail to compile if they disagree |
| `validator/{envelope,structure,bindings,catalog,scope}.ts` | Layers 1–3 are A2UI conformance. Only layer 4 (`rules.ts`) is yours |
| The LangGraph graph and node structure | Prompt content is yours; the graph is not |
| `golden/validator/ref-*.json` | A2UI conformance cases |
| The Studio, the HTTP routes, the stores | Content-agnostic |

Two traps when you *do* extend the agent: the LangGraph adapter declares a
channel per state field (`GraphState` in `adapters/langgraph/src/index.ts`), and
`withListCache` forwards `CompositionStore` methods by hand. Miss either and your
new field or method is silently dropped with **no type error**.

---

## 6. Baseline you are starting from

The fork has been cleaned up for this purpose. Removed: a duplicate copy of
`PLAN.md`, an unused `src/mocks/vds-rules.json` and its dead types, six
`golden/validator/seed-*.json` fixtures that were verbatim copies of the seed
documents, and stale `flows` content from the plan docs. Added: the preflight
script, the mock-vs-seed drift guard, the exact-version guard, and a test that
validates the seed documents directly instead of from copies.

Green baseline at the time of writing:

```
npm test                → 15 files, 138 tests
npm run server:test     → 27 files, 260 tests (1 file, 4 tests skipped: opt-in live model)
npx tsc -b              → clean
server typecheck        → clean
npm run lint            → clean
```

If your fork is not green before you start Phase B, fix that first. You will be
reading these numbers a lot.

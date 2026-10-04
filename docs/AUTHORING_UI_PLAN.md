# Authoring UI (Studio) — plan

> Plan written 2026-10-04. An interactive, remote-only UI for creating and
> editing compositions, page templates and mappings, with Postgres as the single
> source of truth. Not yet built.

## Context

Today there is no way to add content without editing JSON files and running a
CLI. All four content tables (`compositions`, `page_templates`, `flows`,
`placements`) are written by exactly one thing: `seedPack` in
`server/adapters/postgres/seed.ts`, driven by `npm run db:seed` from
`ds-packs/vds/seed/*.json`. Over HTTP the backend is **entirely read-only** —
five routes, four of them `select`, plus the prompt SSE stream.

That makes iteration slow: adding one tile means editing a file, re-running the
seeder, and restarting. This plan replaces that loop with a Studio UI that writes
straight to Postgres.

### Decisions taken

| Decision | Choice |
|---|---|
| Source of truth | **Postgres only.** Seed files become a one-time sample import, never a recurring sync |
| Existing seeded content | Imported once, then fully editable and deletable like anything else |
| A2UI authoring | Paste/import JSON with live preview and validation — not a visual tree builder |
| Per-item rules | Free-text guidance that **steers the agent**, injected into the prompt; not validator-enforced |
| Edit scope | Full CRUD — create new and edit or delete any existing record |

## 1. The architecture shift: seed → one-time sample import

This is the change that makes everything else safe, and it is small.

`seedPack` currently upserts (`insert ... on conflict (id) do update`), so
re-running it overwrites whatever the UI authored. Change it to **insert-only**:

```sql
insert into compositions (...) values (...) on conflict (id) do nothing
```

With `do nothing`, running the importer twice can never clobber authored work,
and a record deleted in the UI stays deleted unless explicitly re-imported.

- Rename the script `db:seed` → `db:samples` so it reads as what it is.
- Add an `origin` column (below) set to `'sample'` on import, so the UI can show
  a "Sample" chip and offer a "Re-import samples" action for a fresh environment.
- Keep `ds-packs/vds/seed/*.json` in git **as sample data only**. Nothing reads
  it at runtime.

**Files:** `server/adapters/postgres/seed.ts`, `server/adapters/postgres/cli.ts`,
`package.json` scripts.

## 2. Data model — `003_authoring.sql`

```sql
-- Per-record authored prose. `description` helps the agent pick a composition;
-- `agent_rules` steers how it edits one. Both are written by people.
alter table compositions
  add column agent_rules text,
  add column origin      text not null default 'authored';

alter table page_templates
  add column description text,
  add column agent_rules text,
  add column origin      text not null default 'authored';

-- Deleting a composition or page must not be blocked by its placements.
alter table placements
  drop constraint placements_composition_id_fkey,
  add  constraint placements_composition_id_fkey
       foreign key (composition_id) references compositions(id) on delete cascade;

alter table placements
  drop constraint placements_page_template_id_fkey,
  add  constraint placements_page_template_id_fkey
       foreign key (page_template_id) references page_templates(id) on delete cascade;

alter table composition_versions
  drop constraint composition_versions_composition_id_fkey,
  add  constraint composition_versions_composition_id_fkey
       foreign key (composition_id) references compositions(id) on delete cascade;
```

Notes on what already exists and needs no migration:

- `compositions.family` and `compositions.description` exist (from `002`).
- `composition_versions` exists with the right shape (`version`, `a2ui`,
  `summary`, `saved_by`, `saved_at`) and **no code touches it**. Use it for
  authoring history.
- `page_templates.flow_id` is a **NOT NULL FK** to `flows`, so creating a page
  requires choosing or creating a flow. The UI must handle this.

### Two fields to derive, not ask for

| Column | Derive from | Why |
|---|---|---|
| `components_used` | `documentComponents(a2ui)` — already exported from `@experience-agent/core` | Don't trust `meta.components`; a pasted doc may omit it. `seed.ts:115` currently trusts it |
| `page_templates.slots` | The document's `Slot` nodes | `RemoteRepository.slotsOf()` already does exactly this client-side. Deriving means slots can never drift from the document |

## 3. Backend

### 3.1 A separate port, not an extended one

Add `AuthoringStore` in `server/packages/core/src/ports.ts` rather than growing
`CompositionStore`. Two reasons, both concrete:

- `withListCache` (`apps/service/src/cache.ts:13-25`) returns an object literal
  that forwards each method by hand. Any method added to `CompositionStore` is
  silently dropped by the cache wrapper.
- `ports.boundary.test.ts` enforces the core/adapter layering; a focused port
  keeps the read path untouched.

```ts
export interface AuthoringStore {
  // compositions
  listCompositions(): Promise<CompositionRecord[]>;
  upsertComposition(input: CompositionInput): Promise<CompositionRecord>;
  deleteComposition(id: string): Promise<void>;
  // page templates + flows
  listPageTemplates(): Promise<PageTemplateRecord[]>;
  upsertPageTemplate(input: PageTemplateInput): Promise<PageTemplateRecord>;
  deletePageTemplate(id: string): Promise<void>;
  listFlows(): Promise<FlowRecord[]>;
  upsertFlow(input: FlowInput): Promise<FlowRecord>;
  // mappings
  placementsForPage(pageTemplateId: string): Promise<PlacementRecord[]>;
  setPlacement(input: PlacementInput): Promise<void>;
  deletePlacement(key: PlacementKey): Promise<void>;
  // history
  appendVersion(compositionId: string, a2ui: A2UIDocument, summary?: string): Promise<number>;
}
```

The SQL is largely a copy of `seed.ts:70-131` with `do nothing` → `do update`.
All queries must set `ds_pack` (from `pack.json`'s `name`) the way seed does.

**Cache invalidation:** `withListCache` must gain an `invalidate()` that the
write routes call. Without it, `GET /v1/compositions` serves stale data for up to
`COMPOSITION_LIST_TTL_MS` (default 30s) after an edit — which will look like
"my save didn't work".

### 3.2 Contract additions

`server/packages/contract/src/index.ts` has no writable shapes at all.
`PlacementView` is a read projection (no `position`, no `compositionId`). Add
Zod schemas + inferred types: `CompositionInput`, `CompositionRecord`,
`PageTemplateInput`, `PageTemplateRecord`, `FlowInput`, `FlowRecord`,
`PlacementInput`, `PlacementRecord`, `ValidationReport`.

`seed.ts:9-41`'s Zod schemas (`SeedComposition` etc.) are the closest existing
shapes — start there, add `agentRules`, and drop fields that are derived.

### 3.3 Routes

`server/apps/service/src/http/app.ts`. **Extend the CORS `allowMethods` list at
line 35** — it currently allows `GET, POST, DELETE, OPTIONS`, so `PUT`/`PATCH`
would fail preflight.

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/authoring/compositions` | List with full records (family, description, rules, origin) |
| PUT | `/v1/authoring/compositions/:id` | Create or update; validates, writes, appends a version |
| DELETE | `/v1/authoring/compositions/:id` | Delete (placements cascade) |
| GET | `/v1/authoring/page-templates` | List |
| PUT | `/v1/authoring/page-templates/:id` | Create or update |
| DELETE | `/v1/authoring/page-templates/:id` | Delete |
| GET | `/v1/authoring/flows` | List |
| PUT | `/v1/authoring/flows/:id` | Create or update |
| GET | `/v1/authoring/page-templates/:id/placements` | Mappings for one page |
| PUT | `/v1/authoring/placements` | Set one placement |
| DELETE | `/v1/authoring/placements` | Remove one placement |
| POST | `/v1/authoring/validate` | Validate a document without saving |
| POST | `/v1/authoring/samples/import` | Re-import sample content (insert-only) |

### 3.4 Validation — reuse, don't reimplement

The core already exports everything needed:

```ts
import { validate, blocking, warnings, type DocumentKind } from "@experience-agent/core";
```

`validate()` runs envelope → catalog → structure → bindings → rules → scope, and
`DocumentKind` is `"composition" | "page"` — the page kind is what lets `Slot`
through (`extras/Slot.ts`, `allowedIn: "page"`).

- `POST /v1/authoring/validate` runs it and returns `{ errors, warnings }` so the
  UI can show live feedback as you type, against the *same* rules the agent is
  held to.
- `PUT` runs it too and returns **422** with the findings when `blocking()` is
  non-empty. Never persist a document that fails validation.
- Pass `kind: "page"` for page templates, `"composition"` otherwise. Omit
  `current` — scope checks only apply to agent edits, not authoring.

## 4. Frontend

Remote-only: the Studio is hidden when `DATA_SOURCE === 'mock'`.

### 4.1 Navigation

There is **no router** in the app and `react-router` is not a dependency.
Rather than adding one, use a ~20-line hash router (`#/studio/compositions/:id`)
so deep links work without a new dep. Add an `appMode` toggle in `AppHeader`.

### 4.2 Service layer

Add `AuthoringRepository` as a **separate interface** (not methods on
`Repository`), implemented only by a new `RemoteAuthoringRepository`. This keeps
`MockRepository` untouched.

Per CLAUDE.md, only a store may call it — add `src/features/studio/studioStore.ts`
(zustand, mirroring `taskStore`). Components read and write the store only.

**Fix while here:** `RemoteRepository.saveComposition` writes to **localStorage
even in remote mode** (`savedCompositions.ts`). Once authoring endpoints exist,
point it at `composition_versions` instead.

**Gotcha:** `RemoteRepository.getPageTemplate` makes no HTTP call — it reads a
cache populated as a side effect of `getMapping`. The Studio needs page templates
independently, which is what `GET /v1/authoring/page-templates` is for.

### 4.3 Components

Nothing reusable exists for forms — no modal, select, textarea or field
component anywhere in `src/`. Reusable today: `IconButton`, `ChatInput` (the
closest text-field pattern), `JsonView` (read-only highlighted JSON),
`ExperienceTileGrid`, and `A2UIRenderer` for the live preview.

Expect to build a small primitives set: `Field`, `TextInput`, `TextArea`,
`Select`, `TagInput`, `Button`, `ConfirmDialog` — plain React + CSS Modules,
reusing the `--glass-*` and `--radius-*` tokens in `src/index.css`.

### 4.4 Screens

```
┌─ Experience Playground ──────────────── [ Playground | Studio ] ─┐
├──────────────┬───────────────────────────────────────────────────┤
│ Compositions │                                                   │
│ Pages        │            (selected section)                     │
│ Mappings     │                                                   │
│ Flows        │                                                   │
└──────────────┴───────────────────────────────────────────────────┘
```

**Composition editor** — the main screen:

```
┌─ Compositions › basic-plan-tile ────── [Sample] [Validate] [Save] ─┐
├────────────────────────────────┬───────────────────────────────────┤
│ METADATA                       │ PREVIEW                           │
│  id       basic-plan-tile      │ ┌───────────────────────────────┐ │
│  name     Basic Plan – Mobile  │ │                               │ │
│  family   Basic Plan Tile      │ │   live <A2UIRenderer/>        │ │
│  type     plan-tile        ▾   │ │                               │ │
│  tags     [plan][mobile] +     │ └───────────────────────────────┘ │
│                                │                                   │
│  description                   │ VALIDATION                        │
│  ┌──────────────────────────┐  │  ● 0 errors   ▲ 1 warning         │
│  │ Mobile version of the    │  │  ▲ bindings/unresolved-binding    │
│  │ basic plan: badge on…    │  │    subtitle → /plan/pric          │
│  └──────────────────────────┘  │                                   │
│  ↳ helps the agent find this   │ DERIVED                           │
│                                │  components  TileContainer, Stack,│
│  agent rules                   │              Badge, Text          │
│  ┌──────────────────────────┐  │                                   │
│  │ Never change the price   │  │ APPEARS IN                        │
│  │ text. Badge may only be  │  │  PDP · plan-summary               │
│  │ red or neonYellow.       │  │  AAL · plan-summary               │
│  └──────────────────────────┘  │  Order Summary · plan-summary     │
│  ↳ sent to the agent on edits  │                                   │
│                                │ HISTORY                           │
│ A2UI DOCUMENT      [Format]    │  v3  2026-10-04  you              │
│  ┌──────────────────────────┐  │  v2  2026-10-03  agent            │
│  │ { "meta": { … },         │  │  v1  imported sample              │
│  │   "a2ui": [ … ] }        │  │                                   │
│  └──────────────────────────┘  │                                   │
└────────────────────────────────┴───────────────────────────────────┘
```

**Page editor** — same layout, with `flow` as a select (plus "new flow…"), and
slots shown **read-only, derived from the document's `Slot` nodes**.

**Mappings** — page-centric, because slots are the constraint:

```
┌─ Mappings ───────────────────────────────────────────────────────┐
│  Page [ PDP  (pdp-mock) ▾ ]                      Flow: PDP       │
├──────────────────────────────────────────────────────────────────┤
│  Slot           Composition                 Variant   Pos        │
│  plan-summary   [ Basic Plan – Mobile  ▾ ]  [      ]  [0]   ✕    │
│  promo-rail     [ — unassigned —       ▾ ]                       │
├──────────────────────────────────────────────────────────────────┤
│  PREVIEW — page rendered with its assigned compositions          │
│  (SurfaceRegistryProvider, exactly as ImpactsView does)           │
└──────────────────────────────────────────────────────────────────┘
```

The preview reuses `ImpactsView`'s existing machinery: `rekeySurface`,
`pageSurfaceId`, `slotSurfaceId` and `SurfaceRegistryProvider`.

## 5. Making authored prose reach the agent

Writing rules is pointless unless the agent sees them. Today **no per-record
prose reaches the model on an edit** — `description` is used only in the `find`
node's disambiguation prompt (`nodes.ts:186`), and `agent_rules` doesn't exist.

- Thread the composition record into the `generate` node and add its
  `agent_rules` to the user message built at `nodes.ts:243-253`, beside the
  retrieved guidelines. The route node already calls `deps.compositions.get`, so
  the record is cheap to carry on `AgentState`.
- Extend `CompositionDetail` (or `CompositionCandidate`) to carry
  `description`/`agentRules`. Note `store.get()` at `store.ts:67` does **not**
  currently select `family`, `description` or `components_used`.
- Order matters in the prompt: pack system prompt → retrieved guidelines →
  per-composition rules, most specific last.

## 6. Build order

| Step | Scope | Done when |
|---|---|---|
| ~~S1~~ ✅ | Migration `003`, seed → insert-only sample import, `origin` column | **Done.** `npm run db:samples` twice reports zeroes; authored rows survive; cascades tested |
| S2 | `AuthoringStore` port + Postgres implementation + contract schemas | Unit tests on the store against a test DB |
| S3 | Authoring routes + `POST /validate` + cache invalidation | Routes exercised by `app.test.ts` |
| S4 | Studio shell, hash router, `studioStore`, form primitives | Studio opens in remote mode, lists compositions |
| S5 | Composition editor: metadata, JSON pane, live preview, validation | Create, edit, delete a composition end to end |
| S6 | Page editor + flow management | Same for pages; slots derived correctly |
| S7 | Mappings builder + page preview | A new mapping shows up in the Playground's Impacts view |
| S8 | Agent wiring: `agent_rules` + `description` into `generate` | A rule demonstrably changes agent behaviour |

S1–S3 are backend and independently testable. S4–S7 are the UI. S8 is what makes
the rules field meaningful and could slip to last.

## 7. Verification

- **Round trip:** create a composition in Studio → it appears in the Playground
  picker → prompt the agent against it → the edit saves to
  `composition_versions`.
- **Re-import safety:** author content, run `npm run db:samples` twice, confirm
  it reports all zeroes the second time and nothing authored changed.
  Note the exact guarantee: `do nothing` protects rows that **exist**, so a
  deleted *sample* row is restored by a re-import — that is what re-importing
  means. Authored rows the importer never knew about stay deleted. Making sample
  deletions sticky would need a tombstone table, which this plan does not call
  for.
- **Validation parity:** paste a document that breaks DS-103 (badge text > 24
  chars); Studio must reject it with the same code the agent gets.
- **Mapping:** add a placement in Studio, open the Playground's Impacts view,
  confirm the new tab appears without a restart.
- **Cache:** save an edit and immediately reload the picker; the new name must
  appear (proves invalidation works).
- **Golden fixtures:** `validator.test.ts:35-40` pins fixture counts by filename
  prefix (`seed-` must be 6). Adding a `seed-*.json` fixture requires bumping it.
  `golden.test.ts:53-60` pins graph fixture names exactly.

## 8. Open questions

1. ~~**Authorship.**~~ **Decided:** write `saved_by = "studio"` for UI saves and
   `"agent"` for agent saves — not one hardcoded value. The call site already
   knows which it is, so the distinction is free and makes the history panel
   readable. Real identity waits for auth.
2. ~~**Delete semantics.**~~ **Decided:** hard delete; the `003` cascades are
   already in place for it. Two UI consequences that follow:
   - The confirm dialog must name what cascades (*"also deletes 3 placements and
     7 saved versions"*). Cascading away version history is unrecoverable, so
     the count has to be visible before the click.
   - For an `origin = 'sample'` row, say that re-importing samples restores it.
     For an authored row, say it does not.
3. **Concurrency.** No optimistic locking. `compositions.updated_at` exists and
   could back an `If-Unmodified-Since`-style check if more than one person will
   author.
4. **`a2ui_version`.** Currently taken from `pack.json`. Authored records should
   probably inherit the same value rather than be asked for.

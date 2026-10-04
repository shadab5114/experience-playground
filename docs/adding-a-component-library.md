# Adding a second component library

> How to register an additional component library (for example
> `@vds-pack/plans`) alongside `@shadab5114/pds-core`, so compositions can draw
> from both. Written 2026-10-04 against pds-core 1.0.0-alpha.11.

## The rule that drives everything

An A2UI v0.9 surface carries exactly **one `catalogId`**, so the thing you
register is a *pack*, not an npm package. Two libraries become one pack with one
catalog identity.

This is enforced in two places, and both will reject a document that gets it
wrong:

- `server/packages/core/src/validator/envelope.ts:40` — `createSurface.catalogId`
  must equal the pack's `catalogId`.
- `server/packages/core/src/validator/scope.ts:22` — the `catalogId` may not
  change across an edit.

So do not try to reference two catalogs from one surface. Define a pack whose
`catalogId` is its own (`https://pdesign.dev/catalog/v1/vds-plans.json`), and
whose component map is the **union** of `@shadab5114/pds-core` and
`@vds-pack/plans`.

The codebase already does this once. `Slot` is not in pds-core's `catalog.json`,
yet it is registered into the same `CatalogSource` under the same `catalogId`,
with a collision check, at `server/ds-packs/vds/catalog.ts:39-49`. A second
library is that pattern scaled up, not a new concept.

## Step 1 — Pack boundary and naming

Keep component names **flat** (`PlanCard`, not `plans:PlanCard`) and guard
collisions at build time.

You own both libraries, so a clash is something you can rename at the source. A
prefix would leak packaging into the wire format, and it would have to be taught
to the model and rewritten into every fixture, golden file and prompt. The
collision guard you need already exists — widen the check at `catalog.ts:40` to
cover the second catalog, and a duplicate name fails the build instead of
silently shadowing.

Decide two things and write them down before you touch code:

| Decision | Recommended | Why |
| --- | --- | --- |
| Pack identity | A new `catalogId` for the combined pack | One surface, one catalog; the validator enforces it |
| Component naming | Flat, build-time collision check | Simpler for the agent; you control both libraries |
| Pack location | Extend `server/ds-packs/vds`, or fork it to `vds-plans` | Fork only if the two should ship independently |

If you ever need to combine libraries you *don't* control, revisit this — that is
the case where prefixing earns its cost.

## Step 2 — What `@vds-pack/plans` must ship

Three artifacts, because three different layers consume them. This is the long
pole: if the library doesn't already emit them, generating them is the bulk of
the work.

| Artifact | Consumed by | What breaks without it |
| --- | --- | --- |
| `catalog.json` — `components` + `$defs` | Playground renderer, server catalog | Everything |
| `schemas` export — one `<Name>Schema` (Zod) per component | `server/ds-packs/vds/catalog.ts:29` | Server **throws** at startup |
| Components exported by name from the package root | `src/a2ui/renderer/registry.ts:14` | Renders as "Unsupported component" |

pds-core clearly generates the first two — reuse that generator rather than
hand-writing them. Hand-written catalogs drift from the components they
describe, and nothing catches it until a composition renders wrong.

### The hard requirement

The new catalog must reuse A2UI's canonical `$defs` names **verbatim**:
`DynamicString`, `DynamicBoolean`, `ChildList`, `IconName`, `ComponentCommon`,
`Action`.

The renderer branches on literal `$ref` strings — `isDynamicRef`,
`isChildListRef` and `isIconNameRef` in `src/a2ui/schema.ts` all compare against
`#/$defs/<Name>`. Rename any of them in your pack and bindings stop resolving
**silently**: no error, just a `{ "path": … }` object handed to React as a prop.

Write a test that asserts both catalogs agree on the shared primitives. It costs
ten lines and it catches the worst failure mode in this whole exercise.

## Step 3 — Playground renderer

Three files, and only one of them is subtle.

| File | Change | Size |
| --- | --- | --- |
| `src/a2ui/schema.ts` | Merge both catalogs; scope `$defs` per catalog | The real work |
| `src/a2ui/renderer/registry.ts` | Build one name → component map from both package namespaces | Trivial |
| `src/a2ui/renderer/icons.tsx` | Only if `@vds-pack/plans` ships its own icons | Often none |

### The `$defs` trap

`derefSchema` resolves `#/$defs/X` against a single global map. With two catalogs
it has no idea which one owns the ref — and both will define entries like
`BadgeProps`. A naive `$defs` merge is silently wrong the moment the two
libraries drift apart.

Fix it by keeping `$defs` **per catalog** and resolving each component's refs
against its own. The ripple is small and bounded: a node's owning catalog is
constant for its entire prop subtree, so it becomes one more field on
`ResolveContext` in `src/a2ui/renderer/resolveValue.ts` rather than a rewrite.

Budget roughly 40 lines across `schema.ts`, `resolveValue.ts` and
`A2UIRenderer.tsx`.

### What stays unchanged

The wire format, `resolveSurface`, the `Slot` hosting machinery and every
existing fixture. Adding a library does not change how a composition is written —
only which component names are legal in it.

## Worked example — a Plan tile from both libraries

Nothing in the renderer tracks "which library am I in". Each node resolves its
own catalog independently, which is exactly why the two compose with no special
handling.

A tile whose chrome is core, whose body is a plans component, and whose plans
component holds core children:

```json
[
  { "id": "root",      "component": "TileContainer", "children": ["content"] },
  { "id": "content",   "component": "Stack", "direction": "column", "children": ["badge", "planCard"] },
  { "id": "badge",     "component": "Badge", "backgroundColor": "red", "children": "Most Popular" },
  { "id": "planCard",  "component": "PlanCard", "tier": "premium", "children": ["price", "perk"] },
  { "id": "price",     "component": "Text", "kind": "title", "children": { "path": "/plan/price" } },
  { "id": "perk",      "component": "PerkRow", "icon": "check", "children": { "path": "/plan/perks" } }
]
```

`TileContainer`, `Stack`, `Badge` and `Text` come from core. `PlanCard` and
`PerkRow` come from plans. The nesting runs both ways: a core `Stack` holds a
plans `PlanCard`, and that `PlanCard` holds a core `Text`.

### What happens per node

For every node, independently, the renderer does the same four things:

1. `isComponentKnown(name)` against the **merged** component map.
2. `getComponentPropertySchemas(name)` — deref'd against **that component's own
   catalog** `$defs` (Step 3).
3. `getRegisteredComponent(name)` — resolved from **that component's own
   package** exports.
4. `resolveValue` walks its props with the shared `ResolveContext`.

There is no mode, no current-library state, no boundary to cross. `renderNode` on
`price` behaves identically whether its parent was core or plans.

### Two things that cross the boundary for free

**The data model is per-surface, not per-library.** `price` binds `/plan/price`
and resolves against the same `dataModel` whether it sits under a core or a plans
parent. Plans components read the same data model core components do — no
bridging, no prefixing of paths.

**Binding context flows through unchanged.** `perk`'s `ChildList` template makes
each `/plan/perks` item the context for everything inside it, including core
components. A plans component can drive a list of core components, and a relative
path inside that list resolves against the item — the rule is the renderer's, not
the library's.

## When the same name exists in both packages

If both libraries export a `Badge`, **one of them must be renamed at merge
time**. There is no configuration that lets both keep the name, because all three
layers key on the bare component string:

| Layer | Structure | Keyed by |
| --- | --- | --- |
| `catalog.json` | `components: Record<string, Schema>` | Component name |
| Server catalog | `Map<string, CatalogEntry>` (`catalog.ts:26`) | Component name |
| Playground registry | Package exports indexed by name (`registry.ts:14`) | Component name |

A JSON object cannot hold two `Badge` keys. So `"component": "Badge"` in a stored
document has exactly one meaning, and the only question is which one — which is a
decision to make deliberately, not resolve at runtime.

### Don't resolve it by precedence

The tempting fix is a package order where one wins. Avoid it. The agent can't
tell which `Badge` it is generating for, a reader of the JSON can't tell which
one rendered, and adding a component to core could silently change what an
existing stored composition renders. Shadowing turns a build error into a
production surprise.

### Rename semantically, in `pack.json`

Give the clashing component a name that says what it *is*, and declare it in the
pack so both merges read the same source of truth:

```json
"catalogPackages": [
  { "name": "@shadab5114/pds-core", "version": "1.0.0-alpha.11" },
  { "name": "@vds-pack/plans", "version": "1.0.0",
    "aliases": { "Badge": "PlanBadge", "Card": "PlanCard" } }
]
```

The merge then registers `PlanBadge`, mapping it back to the `Badge` export of
`@vds-pack/plans`. The agent writes `"component": "PlanBadge"`, the validator
looks up `PlanBadge`, the renderer resolves `PlanBadge` to plans' `Badge` export.
Core's `Badge` is untouched.

### Why not `plans:Badge`

A prefix is mechanical and needs no alias map, but it writes **packaging into the
wire format**. Stored A2UI documents live in Postgres indefinitely. Move
`PlanCard` into core later, or rename the package, and every stored version
carries a name that no longer resolves. `PlanBadge` survives repackaging because
it describes the component, not where it currently ships from.

A prefix is also inconsistent in practice: you either prefix all of plans'
components — noisy, when most don't clash — or only the clashing ones, so the
convention holds for `plans:Badge` but not `PlanCard`.

### Keep the build error

A collision with no alias should fail the build (Step 1's guard). That error is
the system telling you a naming decision is outstanding — it is not something to
suppress with a precedence rule. Apply aliases from `pack.json` in **both** the
playground merge and the server merge. If the two disagree, the agent emits a
name the renderer can't resolve, and you get "Unsupported component" for a
component that validates cleanly.

## Step 4 — Server and agent

Mechanical, but skip the last item and nothing you built will ever be used.

1. **Merge the catalog source.** In `server/ds-packs/vds/catalog.ts`, loop over
   both packages into the same `entries` map. The collision check at line 40
   already does the right thing — widen it so it also covers the second catalog.
2. **Update `pack.json`.** Add the second entry under `catalogPackage` (it is
   currently a single object, so this becomes a list), and set the pack-level
   `catalogId`. Add your new types to `compositionTypes` — today it holds
   `plan-tile` and `summary-tile`.
3. **Add design rules.** `rules.json` currently carries placeholder `DS-1xx`
   rules and `capColors`. Without entries for the new components they are
   validated for *shape* but not for *design* — the agent can produce
   structurally valid output that breaks your plan guidelines.
4. **Add guidelines.** `guidelines.json` feeds the RAG collection named in
   `pack.json`. New components need retrievable guidance or the agent reasons
   about them from the catalog alone.
5. **Update the system prompt.** `server/ds-packs/vds/prompts/system.md`
   currently says *"compositions built from the VDS component catalog"* and gives
   VDS-specific hints, such as what "cap" means on a plan tile. Add the
   equivalent for your plan components.

Step 5 is the one people skip. A model that doesn't know `PlanCard` exists will
never emit it — your catalog can be flawless and nothing changes in practice.

One useful lever: `CatalogEntry.allowedIn` already supports `"both" | "page"`.
Use it if a plan component should only be legal in certain surfaces, the way
`Slot` is page-only.

## Step 5 — Prove it composes

The test that matters is **one composition whose tree mixes both libraries** — a
pds-core `Stack` holding a `PlanCard`, and a `PlanCard` whose own `ChildList`
holds pds-core `Text` nodes. Nesting in both directions is what exercises the
`$defs` scoping.

- [ ] Both catalogs agree on the shared A2UI `$defs` names (the ten-line test from Step 2)
- [ ] A duplicate component name across the two packages fails the build
- [ ] A mixed composition renders with no "Unsupported component" fallback
- [ ] A binding inside a `@vds-pack/plans` component resolves against the data model
- [ ] A `ChildList` crossing the library boundary renders, both directions
- [ ] Golden fixtures under `server/ds-packs/vds/golden/graph` cover an edit touching a plans component
- [ ] A failing fixture under `golden/validator` covers a plans-specific design rule
- [ ] The agent actually emits a plans component from a plain prompt

That last box is the real acceptance test. Everything above it can pass while the
feature is still inert.

The existing `catalog-showcase-tile` fixture is the model to copy — it renders
every component in the catalog once and fails when the catalog grows, which is
exactly the guard you want for a second library.

### A dev-server trap worth knowing

A dev server left running from before an install keeps serving Vite's old
pre-bundled deps, and Playwright's `reuseExistingServer` will happily reuse it.
Real components then report as "Unsupported component" for no visible reason.
After adding or upgrading a package: kill any listener on the dev port, clear
`node_modules/.vite`, and only then trust a negative result.

## Effort and sharp edges

**If the library already ships `catalog.json`, Zod schemas and named exports:
about a day**, most of it the `$defs` scoping and the golden fixtures. **If it
doesn't, generating those is the project** and the rest is the day.

Two failure modes are silent, which is what makes them expensive:

| Trap | How it shows up | Guard |
| --- | --- | --- |
| `$defs` collision between catalogs | No error. A prop resolves against the wrong schema, or a binding passes through as a raw `{ path }` object | Scope `$defs` per catalog (Step 3); assert shared primitive names (Step 2) |
| System prompt never mentions the new components | Everything passes, the agent simply never emits them | The last checkbox in Step 5 |

A third is loud but easy to misread: the server **throws at startup** if any
catalog component lacks a `<Name>Schema` export. That is `catalog.ts:29` doing
its job — it means the library's schema generation is incomplete, not that the
merge is wrong.

### Suggested order

Do the playground half first, against a stub `@vds-pack/plans` catalog with two
or three components. That is where the design risk sits. Proving the `$defs`
scoping works de-risks everything else before you invest in generating the real
catalog.

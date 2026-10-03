# Impact pages: slot hosting (UI)

> Decision doc as given, 2026-10-03. Preserved verbatim as the reference for
> when the Impacts view (plan milestone M5) is actually built. See CLAUDE.md
> for what's already been laid as groundwork vs. still deferred.

## Decision
A composition is placed into a page as its own A2UI surface, hosted inside a
`Slot` placeholder. Do NOT merge the composition into the page document
(no id prefixing, no data-path rewriting). This replaces the "page composer"
merge approach in docs/PLAN.md.

## Conventions
- Page templates use the same shape as compositions: an array of A2UI messages
  (createSurface, updateDataModel, updateComponents).
- A page marks where a composition goes with a playground-only component:
  { "id": "plan-slot", "component": "Slot", "slotId": "plan-summary" }
  `Slot` is not part of the VDS catalog and appears only in page templates.
- Surface keys:
  - page surface:        page:<pageTemplateId>
  - composition surface: slot:<pageTemplateId>:<slotId>
- On load, rewrite only the `surfaceId` field in every message to these keys.
  Never change component ids, data paths, or actions.

## Steps
1. Renderer: support multiple live surfaces at once (a store keyed by surfaceId).
2. Renderer: register `Slot` → renders <SurfaceHost surfaceId="slot:<pageId>:<slotId>">.
   An unknown or empty slot shows a visible "Empty slot: <slotId>" box.
3. Add `rekeySurface(messages, newSurfaceId)` utility with unit tests.
4. Impacts view, per tab: load placements, feed page messages to the page
   surface, feed the current version's messages to each slot surface.
5. Slot wrapper shows the dashed outline + "Updated tile" tag. The placement's
   `variant` is applied as a class on the wrapper, never inside the composition.
6. On a new version: replace only the slot surface's messages; the page surface
   stays; the user stays on the same tab.
7. Actions fired inside impact previews are logged, not executed.
8. Update mock fixtures: PDP, AAL, Order Summary page templates get a `Slot`;
   mappings use the same slotId.
9. Remove the old merge/prefix composer code and its tests.

## Done when
- Each impact tab renders the full mock page with the composition in its slot.
- The JSON view and Copy output are byte-identical to the composition's own
  messages (except nothing; no rewriting is visible to the user).
- A prompt on an impact tab re-renders only the slot, in place.
- Unit tests cover rekeySurface and the Slot fallback.

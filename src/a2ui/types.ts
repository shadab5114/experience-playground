/**
 * A2UI document shape used by this app — the real A2UI v0.9 wire envelope
 * (per the figma-to-a2ui skill's `references/a2ui-format.md` and real
 * production examples), not an invented shortcut. This is what a real
 * Experience Agent actually emits, so it's what flows through the whole
 * system: `Version.a2ui`, the JSON view, Copy, everything.
 *
 * A document is a `meta` header (provider/model/catalogId/generatedAt —
 * useful for debugging which agent produced a version, mirrors how a real
 * agent would annotate its own output) plus an ordered `a2ui` message log.
 * This app's mock/task-store usage always produces a self-contained
 * document — exactly one `createSurface`, one `updateDataModel` (full
 * replace via `path: "/"`), one `updateComponents` (the whole component
 * list) — matching the plan's "a `result` event always carries the whole
 * new A2UI document, never a patch". A real streaming agent could emit more
 * messages over time; `resolveSurface` (src/a2ui/resolveSurface.ts) handles
 * that general case too (later messages win on conflicting ids/paths).
 */
export interface A2UIComponentNode {
  id: string
  /** Catalog component name, e.g. "Stack", "Text", "Badge". */
  component: string
  [prop: string]: unknown
}

export interface A2UICreateSurfaceMessage {
  version: 'v0.9'
  createSurface: { surfaceId: string; catalogId: string }
}

export interface A2UIUpdateDataModelMessage {
  version: 'v0.9'
  updateDataModel: { surfaceId: string; path: string; value: unknown }
}

export interface A2UIUpdateComponentsMessage {
  version: 'v0.9'
  updateComponents: { surfaceId: string; components: A2UIComponentNode[] }
}

export interface A2UIDeleteSurfaceMessage {
  version: 'v0.9'
  deleteSurface: { surfaceId: string }
}

export type A2UIMessage = A2UICreateSurfaceMessage | A2UIUpdateDataModelMessage | A2UIUpdateComponentsMessage | A2UIDeleteSurfaceMessage

export interface A2UIMeta {
  provider?: string
  model?: string
  catalogId: string
  /** Catalog component names used in this document — informational, for debugging/review. */
  components?: string[]
  generatedAt?: string
}

export interface A2UIDocument {
  meta?: A2UIMeta
  a2ui: A2UIMessage[]
}

/** A bindable string: either a literal, or `{ path }` resolved against the current binding context. */
export type DynamicString = string | { path: string }

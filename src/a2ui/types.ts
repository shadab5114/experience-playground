/**
 * A2UI document shape used by this app. The types live in the shared contract
 * package (server/packages/contract/src/a2ui.ts) so the playground and the
 * backend use one definition. This file re-exports them, so existing imports
 * in the renderer and the store keep working.
 *
 * A document is a `meta` header plus an ordered `a2ui` message log. This app's
 * documents are self-contained snapshots: one `createSurface`, one
 * `updateDataModel` (full replace via `path: "/"`), one `updateComponents`
 * (the whole component list), matching the plan's "a `result` event always
 * carries the whole new A2UI document, never a patch".
 */
export type {
  A2UIComponentNode,
  A2UICreateSurfaceMessage,
  A2UIDeleteSurfaceMessage,
  A2UIDocument,
  A2UIMessage,
  A2UIMeta,
  A2UIUpdateComponentsMessage,
  A2UIUpdateDataModelMessage,
  DynamicString,
} from '@experience-agent/contract'

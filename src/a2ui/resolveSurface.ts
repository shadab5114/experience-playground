import type { A2UIComponentNode, A2UIDocument } from './types'

export interface ResolvedSurface {
  surfaceId: string
  catalogId: string
  /** The root data model — the binding target for any `{ path: "/..." }` (absolute) binding. */
  dataModel: Record<string, unknown>
  componentsById: Map<string, A2UIComponentNode>
}

/** Immutable set at an arbitrary JSON Pointer path, creating intermediate objects as needed. */
function setByJsonPointer(root: Record<string, unknown>, pointer: string, value: unknown): Record<string, unknown> {
  if (pointer === '' || pointer === '/') return value as Record<string, unknown>

  const parts = pointer.split('/').slice(1).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  const next = { ...root }
  let cursor: Record<string, unknown> = next
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    const existing = cursor[key]
    const copy = existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {}
    cursor[key] = copy
    cursor = copy
  }
  cursor[parts[parts.length - 1]] = value
  return next
}

/**
 * Merges a document's message log into one renderable surface: the last
 * `createSurface` wins for identity, `updateDataModel` messages apply in
 * order (so a later one can patch a sub-path of an earlier one), and
 * `updateComponents` messages merge by component id (a later message
 * updates/adds, never removes — matches how a real streaming agent would
 * patch a long-lived surface).
 */
export function resolveSurface(document: A2UIDocument): ResolvedSurface {
  let surfaceId = ''
  let catalogId = document.meta?.catalogId ?? ''
  let dataModel: Record<string, unknown> = {}
  const componentsById = new Map<string, A2UIComponentNode>()

  for (const message of document.a2ui) {
    if ('createSurface' in message) {
      surfaceId = message.createSurface.surfaceId
      catalogId = message.createSurface.catalogId
    } else if ('updateDataModel' in message) {
      dataModel = setByJsonPointer(dataModel, message.updateDataModel.path, message.updateDataModel.value)
    } else if ('updateComponents' in message) {
      for (const node of message.updateComponents.components) {
        componentsById.set(node.id, node)
      }
    }
    // deleteSurface: nothing to resolve for a single-surface document; ignored here.
  }

  return { surfaceId, catalogId, dataModel, componentsById }
}

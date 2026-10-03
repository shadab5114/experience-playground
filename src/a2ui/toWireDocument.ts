import type { A2UIComponentNode, A2UIDocument, A2UIMeta } from './types'

/**
 * Encodes a resolved surface back into a self-contained wire document — the
 * inverse of `resolveSurface`. Always exactly one `createSurface`, one
 * `updateDataModel` (full replace via `path: "/"`), one `updateComponents`
 * (the whole component list), matching how this app's versions are always
 * complete snapshots, never incremental patches (see `src/a2ui/types.ts`).
 */
export function toWireDocument(params: {
  surfaceId: string
  catalogId: string
  dataModel: Record<string, unknown>
  components: A2UIComponentNode[]
  meta?: A2UIMeta
}): A2UIDocument {
  const { surfaceId, catalogId, dataModel, components, meta } = params
  return {
    meta,
    a2ui: [
      { version: 'v0.9', createSurface: { surfaceId, catalogId } },
      { version: 'v0.9', updateDataModel: { surfaceId, path: '/', value: dataModel } },
      { version: 'v0.9', updateComponents: { surfaceId, components } },
    ],
  }
}

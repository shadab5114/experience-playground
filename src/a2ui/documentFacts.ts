import type { A2UIDocument } from './types'

/**
 * Facts read straight out of a document, never from `meta` — a hand-edited
 * document's `meta.components` can be absent or stale. The backend derives the
 * same things server-side (`documentComponents`/`documentSlots` in
 * packages/core/src/document.ts); this is the client-side copy the Studio's
 * DERIVED panel shows while you type, before anything is saved.
 */
function componentNodes(doc: A2UIDocument) {
  return doc.a2ui.flatMap((message) => ('updateComponents' in message ? message.updateComponents.components : []))
}

export function documentComponents(doc: A2UIDocument): string[] {
  return [...new Set(componentNodes(doc).map((node) => node.component))]
}

export function documentSlots(doc: A2UIDocument): string[] {
  const ids = componentNodes(doc)
    .filter((node) => node.component === 'Slot' && typeof node.slotId === 'string')
    .map((node) => node.slotId as string)
  return [...new Set(ids)]
}

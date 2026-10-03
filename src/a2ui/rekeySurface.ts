import type { A2UIMessage } from './types'

/** The `surfaceId` carried by any message kind, without relying on object key order. */
export function getMessageSurfaceId(message: A2UIMessage): string {
  if ('createSurface' in message) return message.createSurface.surfaceId
  if ('updateDataModel' in message) return message.updateDataModel.surfaceId
  if ('updateComponents' in message) return message.updateComponents.surfaceId
  return message.deleteSurface.surfaceId
}

/**
 * Returns a copy of `messages` with every message's `surfaceId` field
 * replaced by `newSurfaceId`. Nothing else changes — component ids, data
 * paths, and actions are untouched. Used to host a page template and a
 * composition as independent surfaces under the slot-hosting convention
 * (see docs/decisions/impact-pages-slot-hosting.md):
 * `page:<pageTemplateId>` for the page, `slot:<pageTemplateId>:<slotId>`
 * for the composition placed in one of its slots.
 */
export function rekeySurface(messages: A2UIMessage[], newSurfaceId: string): A2UIMessage[] {
  return messages.map((message) => {
    if ('createSurface' in message) {
      return { ...message, createSurface: { ...message.createSurface, surfaceId: newSurfaceId } }
    }
    if ('updateDataModel' in message) {
      return { ...message, updateDataModel: { ...message.updateDataModel, surfaceId: newSurfaceId } }
    }
    if ('updateComponents' in message) {
      return { ...message, updateComponents: { ...message.updateComponents, surfaceId: newSurfaceId } }
    }
    return { ...message, deleteSurface: { ...message.deleteSurface, surfaceId: newSurfaceId } }
  })
}

/** `slot:<pageTemplateId>:<slotId>` — the surfaceId a composition is rekeyed to when hosted in a page's slot. */
export function slotSurfaceId(pageTemplateId: string, slotId: string): string {
  return `slot:${pageTemplateId}:${slotId}`
}

/** `page:<pageTemplateId>` — the surfaceId a page template is rekeyed to. */
export function pageSurfaceId(pageTemplateId: string): string {
  return `page:${pageTemplateId}`
}

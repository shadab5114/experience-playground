import { createContext } from 'react'
import type { A2UIDocument } from '../types'

/**
 * Multiple live surfaces at once, keyed by surfaceId — the foundation the
 * Impacts view's slot hosting needs (docs/decisions/impact-pages-slot-hosting.md):
 * a page surface (`page:<pageTemplateId>`) and, per `Slot`, the composition
 * hosted in it (`slot:<pageTemplateId>:<slotId>`), each independent — never
 * merged into one document.
 */
export type SurfaceRegistry = Map<string, A2UIDocument>

export const SurfaceRegistryContext = createContext<SurfaceRegistry | null>(null)

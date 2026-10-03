import type { ReactNode } from 'react'
import { SurfaceRegistryContext, type SurfaceRegistry } from './SurfaceRegistryContext'

/**
 * Nothing populates this yet (the Impacts view itself isn't built). It's
 * safe to leave unprovided: `useSurfaceDocument` (./useSurfaceDocument.ts)
 * returns `undefined` with no provider mounted, and `A2UIRenderer`'s `Slot`
 * handling degrades to the "Empty slot" box rather than throwing.
 */
export function SurfaceRegistryProvider({ registry, children }: { registry: SurfaceRegistry; children: ReactNode }) {
  return <SurfaceRegistryContext.Provider value={registry}>{children}</SurfaceRegistryContext.Provider>
}

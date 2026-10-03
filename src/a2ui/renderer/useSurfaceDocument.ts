import { useContext } from 'react'
import { SurfaceRegistryContext } from './SurfaceRegistryContext'

export function useSurfaceDocument(surfaceId: string | undefined) {
  const registry = useContext(SurfaceRegistryContext)
  if (!surfaceId) return undefined
  return registry?.get(surfaceId)
}

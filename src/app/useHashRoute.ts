import { useEffect, useState } from 'react'

/**
 * A tiny hash router. The app has no router and `react-router` is not a
 * dependency; deep links into the Studio (`#/studio/compositions/basic-plan-tile`)
 * are the only routing this app needs, so this is the whole thing.
 *
 * The playground itself stays at `#/` (or no hash at all) and keeps its
 * existing state-in-the-store behaviour — picking a tile does not change the URL.
 */
export const STUDIO_SECTIONS = ['compositions', 'pages', 'mappings', 'flows'] as const
export type StudioSection = (typeof STUDIO_SECTIONS)[number]

export type Route = { mode: 'playground' } | { mode: 'studio'; section: StudioSection; id?: string }

function isSection(value: string | undefined): value is StudioSection {
  return value !== undefined && (STUDIO_SECTIONS as readonly string[]).includes(value)
}

export function parseRoute(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })

  if (parts[0] !== 'studio') return { mode: 'playground' }
  // An unknown section falls back to compositions rather than a dead screen.
  const section = isSection(parts[1]) ? parts[1] : 'compositions'
  return { mode: 'studio', section, ...(parts[2] ? { id: parts[2] } : {}) }
}

export function routeHash(route: Route): string {
  if (route.mode === 'playground') return '#/'
  const id = route.id ? `/${encodeURIComponent(route.id)}` : ''
  return `#/studio/${route.section}${id}`
}

/** Changes the hash, which the hashchange listener below turns into a re-render. */
export function navigate(route: Route): void {
  window.location.hash = routeHash(route)
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    // The hash may already have changed between the initial state and this effect.
    onChange()
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}

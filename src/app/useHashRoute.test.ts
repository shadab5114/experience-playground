import { describe, expect, test } from 'vitest'
import { parseRoute, routeHash, STUDIO_SECTIONS, type Route } from './useHashRoute'

describe('parseRoute', () => {
  test('anything that is not a studio route is the playground', () => {
    for (const hash of ['', '#', '#/', '#/anything', '#/playground']) {
      expect({ hash, route: parseRoute(hash) }).toEqual({ hash, route: { mode: 'playground' } })
    }
  })

  test('#/studio defaults to the compositions section', () => {
    expect(parseRoute('#/studio')).toEqual({ mode: 'studio', section: 'compositions' })
  })

  test('each section is reachable by name', () => {
    for (const section of STUDIO_SECTIONS) {
      expect(parseRoute(`#/studio/${section}`)).toEqual({ mode: 'studio', section })
    }
  })

  test('an unknown section falls back to compositions rather than a dead screen', () => {
    expect(parseRoute('#/studio/nonsense')).toEqual({ mode: 'studio', section: 'compositions' })
  })

  test('a third segment is the record id, percent-decoded', () => {
    expect(parseRoute('#/studio/compositions/basic-plan-tile')).toEqual({
      mode: 'studio',
      section: 'compositions',
      id: 'basic-plan-tile',
    })
    expect(parseRoute('#/studio/compositions/a%20b')).toMatchObject({ id: 'a b' })
  })

  test('a malformed escape is kept verbatim instead of throwing', () => {
    expect(parseRoute('#/studio/compositions/%E0%A4%A')).toMatchObject({ id: '%E0%A4%A' })
  })
})

describe('routeHash', () => {
  test('round-trips every route back through parseRoute', () => {
    const routes: Route[] = [
      { mode: 'playground' },
      ...STUDIO_SECTIONS.map((section) => ({ mode: 'studio' as const, section })),
      { mode: 'studio', section: 'compositions', id: 'basic-plan-tile' },
    ]
    for (const route of routes) {
      expect({ route, parsed: parseRoute(routeHash(route)) }).toEqual({ route, parsed: route })
    }
  })

  test('encodes an id so a slash cannot invent a segment', () => {
    expect(routeHash({ mode: 'studio', section: 'compositions', id: 'a/b' })).toBe('#/studio/compositions/a%2Fb')
    expect(parseRoute('#/studio/compositions/a%2Fb')).toMatchObject({ id: 'a/b' })
  })
})

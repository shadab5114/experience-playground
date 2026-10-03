import { describe, expect, it } from 'vitest'
import { pageSurfaceId, rekeySurface, slotSurfaceId } from './rekeySurface'
import type { A2UIMessage } from './types'

const messages: A2UIMessage[] = [
  { version: 'v0.9', createSurface: { surfaceId: 'main', catalogId: 'https://pdesign.dev/catalog/v1/catalog.json' } },
  { version: 'v0.9', updateDataModel: { surfaceId: 'main', path: '/', value: { plan: { name: 'Basic Plan' } } } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'main',
      components: [{ id: 'root', component: 'Text', children: { path: '/plan/name' } }],
    },
  },
]

describe('rekeySurface', () => {
  it('rewrites surfaceId on every message kind and nothing else', () => {
    const rekeyed = rekeySurface(messages, 'slot:pdp-mock:plan-summary')

    expect(rekeyed[0]).toEqual({
      version: 'v0.9',
      createSurface: { surfaceId: 'slot:pdp-mock:plan-summary', catalogId: 'https://pdesign.dev/catalog/v1/catalog.json' },
    })
    expect(rekeyed[1]).toEqual({
      version: 'v0.9',
      updateDataModel: { surfaceId: 'slot:pdp-mock:plan-summary', path: '/', value: { plan: { name: 'Basic Plan' } } },
    })
    // Component ids and data paths are untouched.
    expect((rekeyed[2] as { updateComponents: { components: unknown[] } }).updateComponents.components).toEqual(
      (messages[2] as { updateComponents: { components: unknown[] } }).updateComponents.components,
    )
  })

  it('does not mutate the original messages', () => {
    const before = JSON.stringify(messages)
    rekeySurface(messages, 'page:pdp-mock')
    expect(JSON.stringify(messages)).toBe(before)
  })
})

describe('slotSurfaceId / pageSurfaceId', () => {
  it('follow the page:<id> / slot:<pageId>:<slotId> convention', () => {
    expect(pageSurfaceId('pdp-mock')).toBe('page:pdp-mock')
    expect(slotSurfaceId('pdp-mock', 'plan-summary')).toBe('slot:pdp-mock:plan-summary')
  })
})

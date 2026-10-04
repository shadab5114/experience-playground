import { describe, expect, test } from 'vitest'
import basicPlanTile from '../../mocks/compositions/basic-plan-tile.json'
import pdpPage from '../../mocks/pages/pdp-mock.json'
import { RemoteRepository } from './RemoteRepository'

const placements = [
  {
    pageTemplateId: 'pdp-mock',
    pageName: 'PDP',
    slotId: 'plan-summary',
    pageA2ui: pdpPage.a2ui,
  },
  {
    pageTemplateId: 'order-summary-mock',
    pageName: 'Order Summary',
    slotId: 'plan-summary',
    variant: 'compact',
    pageA2ui: pdpPage.a2ui,
  },
]

const compositionDetail = {
  compositionId: basicPlanTile.id,
  name: basicPlanTile.name,
  family: 'Basic Plan Tile',
  description: 'Mobile version of the basic plan.',
  agentRules: 'Never change the price text.',
  type: 'plan-tile',
  tags: ['plan'],
  a2ui: basicPlanTile.a2ui,
}

/** Serves the backend's read routes from fixtures shaped like the real responses. */
function fakeApi(routes: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const path = url.replace('http://api.test', '')
    if (!(path in routes)) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(routes[path]), { status: 200 })
  }) as typeof fetch
}

describe('RemoteRepository', () => {
  test('lists compositions as experiences', async () => {
    const repo = new RemoteRepository('http://api.test', fakeApi({
      '/v1/compositions': [{ compositionId: 'basic-plan-tile', name: 'Basic Plan – Mobile', type: 'plan-tile', tags: ['plan', 'mobile'] }],
    }))
    expect(await repo.listExperiences()).toEqual([
      { id: 'basic-plan-tile', name: 'Basic Plan – Mobile', description: 'plan, mobile', compositionId: 'basic-plan-tile' },
    ])
  })

  test('loads a composition and maps it to the playground shape', async () => {
    const repo = new RemoteRepository('http://api.test', fakeApi({ '/v1/compositions/basic-plan-tile': compositionDetail }))
    const composition = await repo.getComposition('basic-plan-tile')
    expect(composition.id).toBe('basic-plan-tile')
    expect(composition.a2ui.a2ui.length).toBeGreaterThan(0)
  })

  test('maps placements to a mapping and caches page templates with their slots', async () => {
    const repo = new RemoteRepository('http://api.test', fakeApi({ '/v1/compositions/basic-plan-tile/placements': placements }))
    const mapping = await repo.getMapping('basic-plan-tile')
    expect(mapping.appearsIn.map((p) => p.pageTemplateId)).toEqual(['pdp-mock', 'order-summary-mock'])
    expect(mapping.appearsIn[1]?.variant).toBe('compact')
    expect(mapping.appearsIn[0]).not.toHaveProperty('variant')

    const template = await repo.getPageTemplate('pdp-mock')
    expect(template.name).toBe('PDP')
    expect(template.slots).toEqual([{ id: 'plan-summary', description: '' }])
  })

  test('getPageTemplate fails clearly before the mapping is loaded', async () => {
    const repo = new RemoteRepository('http://api.test', fakeApi({}))
    await expect(repo.getPageTemplate('pdp-mock')).rejects.toThrow('not loaded')
  })

  test('a response that does not match the contract is rejected', async () => {
    const repo = new RemoteRepository('http://api.test', fakeApi({ '/v1/compositions': [{ id: 'wrong' }] }))
    await expect(repo.listExperiences()).rejects.toThrow()
  })

  test('a failed request reports its status', async () => {
    const repo = new RemoteRepository('http://api.test', fakeApi({}))
    await expect(repo.getComposition('missing')).rejects.toThrow('(404)')
  })
})

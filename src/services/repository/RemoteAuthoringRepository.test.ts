import { describe, expect, test } from 'vitest'
import type { CompositionInput } from '@experience-agent/contract'
import basicPlanTile from '../../mocks/compositions/basic-plan-tile.json'
import type { A2UIDocument } from '../../a2ui/types'
import { RemoteAuthoringRepository } from './RemoteAuthoringRepository'

// The fixture is read from JSON, so its type is the literal shape, not A2UIDocument.
const doc = basicPlanTile.a2ui as unknown as A2UIDocument

const record = {
  compositionId: 'basic-plan-tile',
  name: 'Basic Plan – Mobile',
  family: 'Basic Plan Tile',
  description: 'Mobile version of the basic plan.',
  type: 'plan-tile',
  tags: ['plan', 'mobile'],
  a2ui: doc,
  componentsUsed: ['TileContainer', 'Stack', 'Badge', 'Text'],
  a2uiVersion: 'v0.9',
  origin: 'sample',
  updatedAt: '2026-10-04T09:30:00.000Z',
}

const input: CompositionInput = {
  compositionId: record.compositionId,
  name: record.name,
  family: record.family,
  description: record.description,
  type: record.type,
  tags: record.tags,
  a2ui: doc,
}

interface Call {
  method: string
  path: string
  body: unknown
}

/** Records every request and answers from a table keyed by "METHOD /path". */
function fakeApi(routes: Record<string, { status?: number; json?: unknown }>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.replace('http://api.test', '')
    calls.push({ method, path, body: init?.body ? JSON.parse(init.body as string) : undefined })
    const route = routes[`${method} ${path}`]
    if (!route) return new Response('not found', { status: 404 })
    const status = route.status ?? 200
    if (status === 204) return new Response(null, { status })
    return new Response(JSON.stringify(route.json ?? {}), { status })
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('RemoteAuthoringRepository', () => {
  test('lists compositions as full records, checked against the contract', async () => {
    const { fetchImpl } = fakeApi({ 'GET /v1/authoring/compositions': { json: [record] } })
    const api = new RemoteAuthoringRepository('http://api.test', fetchImpl)
    const records = await api.listCompositions()
    expect(records[0]?.origin).toBe('sample')
    expect(records[0]?.componentsUsed).toContain('TileContainer')
  })

  test('a response that breaks the contract throws instead of reaching the UI', async () => {
    const { fetchImpl } = fakeApi({
      'GET /v1/authoring/compositions': { json: [{ ...record, origin: 'imported' }] },
    })
    const api = new RemoteAuthoringRepository('http://api.test', fetchImpl)
    await expect(api.listCompositions()).rejects.toThrow()
  })

  test('saving sends a PUT to the record id and returns the version it was given', async () => {
    const { fetchImpl, calls } = fakeApi({
      'PUT /v1/authoring/compositions/basic-plan-tile': { json: { record, version: 3, warnings: [] } },
    })
    const api = new RemoteAuthoringRepository('http://api.test', fetchImpl)
    const result = await api.saveComposition(input, 'Pasted the first draft')

    expect(result).toMatchObject({ ok: true, version: 3 })
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/v1/authoring/compositions/basic-plan-tile' })
    // The summary rides alongside the input; it is not part of the record.
    expect(calls[0]?.body).toMatchObject({ compositionId: 'basic-plan-tile', summary: 'Pasted the first draft' })
  })

  test('a summary is left out entirely when there is none', async () => {
    const { fetchImpl, calls } = fakeApi({
      'PUT /v1/authoring/compositions/basic-plan-tile': { json: { record, version: 1, warnings: [] } },
    })
    await new RemoteAuthoringRepository('http://api.test', fetchImpl).saveComposition(input)
    expect(calls[0]?.body).not.toHaveProperty('summary')
  })

  // A rejected document is an answer the editor renders, not an exception.
  test('a 422 comes back as findings rather than throwing', async () => {
    const findings = [
      {
        severity: 'error',
        layer: 'rules',
        code: 'DS-103',
        componentId: 'badge',
        path: '/components/badge/children',
        message: 'badge text is too long',
      },
    ]
    const { fetchImpl } = fakeApi({
      'PUT /v1/authoring/compositions/basic-plan-tile': {
        status: 422,
        json: { error: 'The document does not validate', errors: findings, warnings: [] },
      },
    })
    const api = new RemoteAuthoringRepository('http://api.test', fetchImpl)
    const result = await api.saveComposition(input)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a rejection')
    expect(result.message).toBe('The document does not validate')
    expect(result.errors[0]).toMatchObject({ code: 'DS-103', componentId: 'badge' })
  })

  test('a 400 comes back as a message, not a crash', async () => {
    const { fetchImpl } = fakeApi({
      'PUT /v1/authoring/compositions/basic-plan-tile': { status: 400, json: { error: 'Invalid composition' } },
    })
    const result = await new RemoteAuthoringRepository('http://api.test', fetchImpl).saveComposition(input)
    expect(result).toEqual({ ok: false, message: 'Invalid composition', errors: [], warnings: [] })
  })

  test('a server fault still throws', async () => {
    const { fetchImpl } = fakeApi({ 'PUT /v1/authoring/compositions/basic-plan-tile': { status: 500 } })
    await expect(
      new RemoteAuthoringRepository('http://api.test', fetchImpl).saveComposition(input),
    ).rejects.toThrow(/500/)
  })

  test('validate posts the document and the kind, and never throws on findings', async () => {
    const { fetchImpl, calls } = fakeApi({
      'POST /v1/authoring/validate': { json: { errors: [], warnings: [] } },
    })
    const api = new RemoteAuthoringRepository('http://api.test', fetchImpl)
    expect(await api.validate(doc, 'page')).toEqual({ errors: [], warnings: [] })
    expect(calls[0]?.body).toMatchObject({ kind: 'page' })
  })

  test('delete and delete-impact hit the record-scoped paths', async () => {
    const { fetchImpl, calls } = fakeApi({
      'DELETE /v1/authoring/compositions/basic-plan-tile': { status: 204 },
      'GET /v1/authoring/compositions/basic-plan-tile/delete-impact': {
        json: { origin: 'sample', placements: 3, savedVersions: 7 },
      },
    })
    const api = new RemoteAuthoringRepository('http://api.test', fetchImpl)
    expect(await api.compositionDeleteImpact('basic-plan-tile')).toEqual({
      origin: 'sample',
      placements: 3,
      savedVersions: 7,
    })
    await api.deleteComposition('basic-plan-tile')
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE'])
  })

  test('an id with a slash is encoded so it cannot invent a path segment', async () => {
    const { fetchImpl, calls } = fakeApi({})
    const api = new RemoteAuthoringRepository('http://api.test', fetchImpl)
    await api.deleteComposition('a/b').catch(() => undefined)
    expect(calls[0]?.path).toBe('/v1/authoring/compositions/a%2Fb')
  })

  test('deleting a placement sends the key as the body', async () => {
    const { fetchImpl, calls } = fakeApi({ 'DELETE /v1/authoring/placements': { status: 204 } })
    const api = new RemoteAuthoringRepository('http://api.test', fetchImpl)
    await api.deletePlacement({ compositionId: 'basic-plan-tile', pageTemplateId: 'pdp-mock', slotId: 'plan-summary' })
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      path: '/v1/authoring/placements',
      body: { compositionId: 'basic-plan-tile', pageTemplateId: 'pdp-mock', slotId: 'plan-summary' },
    })
  })
})

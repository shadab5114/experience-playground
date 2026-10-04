import { beforeEach, describe, expect, test, vi } from 'vitest'
import basicPlanTile from '../../mocks/compositions/basic-plan-tile.json'
import type { A2UIDocument } from '../../a2ui/types'

// The store talks only to these two services, so they are the only things mocked.
const { authoring, repo, task } = vi.hoisted(() => ({
  authoring: {
    listCompositions: vi.fn(),
    saveComposition: vi.fn(),
    deleteComposition: vi.fn(),
    compositionDeleteImpact: vi.fn(),
    listVersions: vi.fn(),
    listPageTemplates: vi.fn(),
    savePageTemplate: vi.fn(),
    deletePageTemplate: vi.fn(),
    pageTemplateDeleteImpact: vi.fn(),
    placementsForPage: vi.fn(),
    setPlacement: vi.fn(),
    deletePlacement: vi.fn(),
    validate: vi.fn(),
    importSamples: vi.fn(),
  },
  repo: { getMapping: vi.fn() },
  // The Studio tells the playground's store when its caches go stale.
  task: { reloadMapping: vi.fn(), invalidateExperiences: vi.fn() },
}))

vi.mock('../../services/createServices', () => ({ services: { authoring, repository: repo } }))
vi.mock('../task/taskStore', () => ({ useTaskStore: { getState: () => task } }))

import { NEW_RECORD, useStudioStore } from './studioStore'
import type { CompositionEditorState, PageEditorState } from './studioStore'

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
  origin: 'sample' as const,
  updatedAt: '2026-10-04T09:30:00.000Z',
}

const pageDoc = {
  a2ui: [
    { version: 'v0.9', createSurface: { surfaceId: 'main', catalogId: 'x' } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'main',
        components: [
          { id: 'root', component: 'Stack', children: ['plan', 'promo'] },
          { id: 'plan', component: 'Slot', slotId: 'plan-summary' },
          { id: 'promo', component: 'Slot', slotId: 'promo-rail' },
        ],
      },
    },
  ],
} as unknown as A2UIDocument

const pageRecord = {
  pageTemplateId: 'pdp-mock',
  name: 'PDP',
  description: 'The product detail page.',
  a2ui: pageDoc,
  slots: ['plan-summary', 'promo-rail'],
  origin: 'sample' as const,
}

const clean = { errors: [], warnings: [] }

beforeEach(() => {
  vi.clearAllMocks()
  useStudioStore.setState({
    loaded: false,
    loading: false,
    error: null,
    compositions: [],
    pages: [],
    editor: null,
    pendingDelete: null,
    mappingsPageId: null,
    placements: [],
    placementsBusy: false,
    notice: null,
  })
  authoring.listCompositions.mockResolvedValue([record])
  authoring.savePageTemplate.mockResolvedValue({ ok: true, record: pageRecord, warnings: [] })
  authoring.pageTemplateDeleteImpact.mockResolvedValue({ origin: 'sample', placements: 1, savedVersions: 0 })
  authoring.deletePageTemplate.mockResolvedValue(undefined)
  authoring.placementsForPage.mockResolvedValue([])
  authoring.setPlacement.mockResolvedValue([])
  authoring.deletePlacement.mockResolvedValue(undefined)
  task.reloadMapping.mockResolvedValue(undefined)
  authoring.listPageTemplates.mockResolvedValue([pageRecord])
  authoring.listVersions.mockResolvedValue([])
  authoring.validate.mockResolvedValue(clean)
  repo.getMapping.mockResolvedValue({ compositionId: 'basic-plan-tile', appearsIn: [] })
})

const store = () => useStudioStore.getState()

/** The open editor, narrowed. Throws rather than silently asserting on undefined. */
function compositionEditor(): CompositionEditorState {
  const editor = useStudioStore.getState().editor
  if (editor?.kind !== 'composition') throw new Error(`expected a composition editor, got ${editor?.kind ?? 'none'}`)
  return editor
}

function pageEditor(): PageEditorState {
  const editor = useStudioStore.getState().editor
  if (editor?.kind !== 'page') throw new Error(`expected a page editor, got ${editor?.kind ?? 'none'}`)
  return editor
}

describe('load', () => {
  test('fetches compositions and pages once', async () => {
    await store().load()
    await store().load()
    expect(store().compositions).toHaveLength(1)
    expect(store().pages).toHaveLength(1)
    expect(authoring.listCompositions).toHaveBeenCalledTimes(1)
  })

  test('a failure becomes a visible error rather than an unhandled rejection', async () => {
    authoring.listCompositions.mockRejectedValue(new Error('backend is down'))
    await store().load()
    expect(store().error).toBe('backend is down')
    expect(store().loading).toBe(false)
  })

  test('force reloads after a sample import', async () => {
    await store().load()
    authoring.importSamples.mockResolvedValue({ compositions: 1, pageTemplates: 0, placements: 2 })
    await store().importSamples()
    expect(authoring.listCompositions).toHaveBeenCalledTimes(2)
    expect(store().notice).toBe('Imported 3 sample rows.')
  })

  test('an import that adds nothing says so', async () => {
    await store().load()
    authoring.importSamples.mockResolvedValue({ compositions: 0, pageTemplates: 0, placements: 0 })
    await store().importSamples()
    expect(store().notice).toMatch(/already present/)
  })
})

describe('openComposition', () => {
  test('fills the form and the JSON pane from the record', async () => {
    await store().openComposition('basic-plan-tile')
    const editor = compositionEditor()
    expect(editor.isNew).toBe(false)
    expect(editor.savedId).toBe('basic-plan-tile')
    expect(editor.form.name).toBe('Basic Plan – Mobile')
    expect(JSON.parse(editor.json)).toEqual(doc)
    expect(editor.dirty).toBe(false)
  })

  test('a null agentRules becomes an empty field, not the string "null"', async () => {
    await store().openComposition('basic-plan-tile')
    expect(compositionEditor().form.agentRules).toBe('')
  })

  test('history and appearances load into the open editor', async () => {
    authoring.listVersions.mockResolvedValue([
      { version: 2, savedBy: 'agent', savedAt: '2026-10-04T10:00:00.000Z' },
      { version: 1, savedBy: 'studio', savedAt: '2026-10-03T10:00:00.000Z' },
    ])
    repo.getMapping.mockResolvedValue({
      compositionId: 'basic-plan-tile',
      appearsIn: [{ pageTemplateId: 'pdp-mock', pageName: 'PDP', slotId: 'plan-summary' }],
    })
    await store().openComposition('basic-plan-tile')
    expect(compositionEditor().versions.map((v) => v.version)).toEqual([2, 1])
    expect(compositionEditor().appearsIn[0]?.pageName).toBe('PDP')
  })

  // Side panels must never keep the editor from opening.
  test('a failing side panel load leaves the editor usable', async () => {
    authoring.listVersions.mockRejectedValue(new Error('nope'))
    repo.getMapping.mockRejectedValue(new Error('nope'))
    await store().openComposition('basic-plan-tile')
    expect(compositionEditor().form.name).toBe('Basic Plan – Mobile')
    expect(compositionEditor().versions).toEqual([])
  })

  test('an unknown id reports instead of opening a blank editor', async () => {
    await store().openComposition('no-such-tile')
    expect(store().editor).toBeNull()
    expect(store().error).toMatch(/no-such-tile/)
  })

  test('with an empty database a new composition has no type to default to', async () => {
    authoring.listCompositions.mockResolvedValue([])
    await store().openComposition(NEW_RECORD)
    expect(compositionEditor().form.type).toBe('')
  })

  test('a new composition starts from a document that already renders', async () => {
    await store().openComposition(NEW_RECORD)
    const editor = compositionEditor()
    expect(editor.isNew).toBe(true)
    expect(editor.savedId).toBeNull()
    expect(editor.form.compositionId).toBe('')
    // Defaulted from a type already in use, not from a hardcoded list.
    expect(editor.form.type).toBe('plan-tile')
    expect(editor.parsed).not.toBeNull()
    expect(editor.parseError).toBeNull()
  })
})

describe('editing the JSON pane', () => {
  test('broken text clears `parsed` but keeps `lastGood` for the preview', async () => {
    await store().openComposition('basic-plan-tile')
    store().editJson('{ "a2ui": [')
    const editor = compositionEditor()
    expect(editor.parseError).toBeTruthy()
    // Nothing may act on a document that is not on screen...
    expect(editor.parsed).toBeNull()
    // ...but the preview keeps rendering instead of blanking on every keystroke.
    expect(editor.lastGood).toEqual(doc)
  })

  test('text that parses but is not an A2UI envelope says which field is wrong', async () => {
    await store().openComposition('basic-plan-tile')
    store().editJson(JSON.stringify({ a2ui: [{ version: 'v0.8' }] }))
    expect(store().editor?.parseError).toMatch(/a2ui/)
  })

  test('good text replaces the document and clears the error', async () => {
    await store().openComposition('basic-plan-tile')
    store().editJson('{ "a2ui": [')
    store().editJson(JSON.stringify(doc))
    expect(store().editor?.parseError).toBeNull()
    expect(store().editor?.parsed).toEqual(doc)
  })

  test('Format rewrites the text from the parsed document', async () => {
    await store().openComposition('basic-plan-tile')
    store().editJson(JSON.stringify(doc))
    store().formatJson()
    expect(store().editor?.json).toBe(JSON.stringify(doc, null, 2))
  })
})

describe('validateNow', () => {
  test('sends the parsed document and stores the report', async () => {
    authoring.validate.mockResolvedValue({
      errors: [],
      warnings: [{ severity: 'warning', layer: 'bindings', code: 'unresolved-binding', path: '/x', message: 'no data' }],
    })
    await store().openComposition('basic-plan-tile')
    await store().validateNow()
    expect(authoring.validate).toHaveBeenCalledWith(doc, 'composition')
    expect(store().editor?.report?.warnings).toHaveLength(1)
  })

  test('broken text is not sent to the server; the parse error is the report', async () => {
    await store().openComposition('basic-plan-tile')
    authoring.validate.mockClear()
    store().editJson('{{{')
    await store().validateNow()
    expect(authoring.validate).not.toHaveBeenCalled()
    expect(store().editor?.report).toBeNull()
  })

  // Otherwise a slow reply would label a document the person has already replaced.
  test('a reply for a document that has since changed is discarded', async () => {
    await store().openComposition('basic-plan-tile')
    let resolveFirst: (r: unknown) => void = () => {}
    authoring.validate.mockImplementation(() => new Promise((resolve) => (resolveFirst = resolve)))

    const inFlight = store().validateNow()
    store().editJson(JSON.stringify({ ...doc, meta: { ...doc.meta, provider: 'edited' } }))
    resolveFirst({ errors: [{ severity: 'error', layer: 'rules', code: 'DS-103', path: '/', message: 'stale' }], warnings: [] })
    await inFlight

    // The stale findings never land; the report from before the edit stands.
    expect(store().editor?.report).toEqual(clean)
  })
})

describe('save', () => {
  const filled = {
    compositionId: 'studio-tile',
    name: 'Studio Tile',
    family: 'Studio Tile',
    description: 'Authored here.',
    agentRules: '  ',
    type: 'plan-tile',
    tags: ['studio'],
  }

  test('sends trimmed fields and drops blank agent rules', async () => {
    await store().openComposition(NEW_RECORD)
    store().editCompositionForm({ ...filled, name: '  Studio Tile  ' })
    authoring.saveComposition.mockResolvedValue({
      ok: true,
      record: { ...record, compositionId: 'studio-tile', origin: 'authored' },
      version: 1,
      warnings: [],
    })

    expect(await store().save()).toBe('studio-tile')
    const sent = authoring.saveComposition.mock.calls[0]?.[0]
    expect(sent.name).toBe('Studio Tile')
    expect(sent).not.toHaveProperty('agentRules')
    expect(store().notice).toBe('Saved as version 1')
  })

  test('a successful save clears dirty and adopts the server record', async () => {
    await store().openComposition('basic-plan-tile')
    store().editCompositionForm({ name: 'Renamed' })
    expect(store().editor?.dirty).toBe(true)

    authoring.saveComposition.mockResolvedValue({ ok: true, record: { ...record, name: 'Renamed' }, version: 2, warnings: [] })
    await store().save()

    expect(store().editor?.dirty).toBe(false)
    expect(compositionEditor().form.name).toBe('Renamed')
    expect(store().compositions[0]?.name).toBe('Renamed')
  })

  test('a rejected document becomes the validation report, and nothing is marked saved', async () => {
    const findings = [{ severity: 'error', layer: 'rules', code: 'DS-103', path: '/', message: 'too long' }]
    await store().openComposition('basic-plan-tile')
    store().editCompositionForm({ name: 'Renamed' })
    authoring.saveComposition.mockResolvedValue({
      ok: false,
      message: 'The document does not validate',
      errors: findings,
      warnings: [],
    })

    expect(await store().save()).toBeNull()
    expect(store().editor?.report?.errors[0]?.code).toBe('DS-103')
    expect(store().editor?.saveError).toBe('The document does not validate')
    expect(store().editor?.dirty).toBe(true)
  })

  test('refuses to save while the JSON is broken', async () => {
    await store().openComposition('basic-plan-tile')
    store().editJson('{{{')
    expect(await store().save()).toBeNull()
    expect(authoring.saveComposition).not.toHaveBeenCalled()
    expect(store().editor?.saveError).toMatch(/Fix the JSON/)
  })

  test('a transport failure is shown, not thrown', async () => {
    await store().openComposition('basic-plan-tile')
    authoring.saveComposition.mockRejectedValue(new Error('network down'))
    expect(await store().save()).toBeNull()
    expect(store().editor?.saveError).toBe('network down')
    expect(store().editor?.saving).toBe(false)
  })
})

describe('delete', () => {
  test('the cascade counts are fetched before the dialog opens', async () => {
    authoring.compositionDeleteImpact.mockResolvedValue({ origin: 'sample', placements: 3, savedVersions: 7 })
    await store().askDelete('composition', 'basic-plan-tile')
    expect(store().pendingDelete).toEqual({
      kind: 'composition',
      id: 'basic-plan-tile',
      impact: { origin: 'sample', placements: 3, savedVersions: 7 },
    })
  })

  test('confirming removes the record from the list and closes its editor', async () => {
    await store().openComposition('basic-plan-tile')
    authoring.compositionDeleteImpact.mockResolvedValue({ origin: 'sample', placements: 0, savedVersions: 0 })
    authoring.deleteComposition.mockResolvedValue(undefined)

    await store().askDelete('composition', 'basic-plan-tile')
    await store().confirmDelete()

    expect(store().compositions).toEqual([])
    expect(store().editor).toBeNull()
    expect(store().pendingDelete).toBeNull()
  })

  test('cancelling deletes nothing', async () => {
    authoring.compositionDeleteImpact.mockResolvedValue({ origin: 'authored', placements: 0, savedVersions: 0 })
    await store().askDelete('composition', 'basic-plan-tile')
    store().cancelDelete()
    expect(store().pendingDelete).toBeNull()
    expect(authoring.deleteComposition).not.toHaveBeenCalled()
  })
})

describe('page templates', () => {
  test('openPage fills the form and keeps slots out of it — they are derived', async () => {
    await store().openPage('pdp-mock')
    const editor = pageEditor()
    expect(editor.form).toEqual({
      pageTemplateId: 'pdp-mock',
      name: 'PDP',
      description: 'The product detail page.',
      agentRules: '',
    })
    expect('slots' in editor.form).toBe(false)
    expect(editor.origin).toBe('sample')
  })

  test('a new page starts empty and is marked new', async () => {
    await store().openPage(NEW_RECORD)
    expect(pageEditor().form.pageTemplateId).toBe('')
    expect(pageEditor().isNew).toBe(true)
  })

  test('a page document is validated as a page, so Slot is allowed', async () => {
    await store().openPage('pdp-mock')
    await store().validateNow()
    expect(authoring.validate).toHaveBeenCalledWith(pageDoc, 'page')
  })

  test('saving sends only typed fields and drops blank optional prose', async () => {
    await store().openPage('pdp-mock')
    store().editPageForm({ name: 'PDP (edited)', description: '  ' })
    await store().save()

    const sent = authoring.savePageTemplate.mock.calls[0]?.[0]
    expect(sent.name).toBe('PDP (edited)')
    expect(sent).not.toHaveProperty('description')
    expect(sent).not.toHaveProperty('agentRules')
    // slots are the server's to derive; the client must not send them.
    expect(sent).not.toHaveProperty('slots')
    expect(store().notice).toBe('Saved pdp-mock')
  })

  test('a rejected page document becomes the validation report', async () => {
    authoring.savePageTemplate.mockResolvedValue({
      ok: false,
      message: 'The document does not validate',
      errors: [{ severity: 'error', layer: 'catalog', code: 'not-allowed-in-kind', path: '/', message: 'no' }],
      warnings: [],
    })
    await store().openPage('pdp-mock')
    store().editPageForm({ name: 'PDP (edited)' })
    expect(await store().save()).toBeNull()
    expect(pageEditor().report?.errors[0]?.code).toBe('not-allowed-in-kind')
    expect(pageEditor().dirty).toBe(true)
  })

  test('deleting a page uses the page impact and leaves compositions alone', async () => {
    await store().load()
    await store().askDelete('page', 'pdp-mock')
    expect(store().pendingDelete).toEqual({
      kind: 'page',
      id: 'pdp-mock',
      impact: { origin: 'sample', placements: 1, savedVersions: 0 },
    })

    await store().confirmDelete()
    expect(authoring.deletePageTemplate).toHaveBeenCalledWith('pdp-mock')
    expect(authoring.deleteComposition).not.toHaveBeenCalled()
    expect(store().pages).toEqual([])
    expect(store().compositions).toHaveLength(1)
  })

  test('an unknown page reports instead of opening a blank editor', async () => {
    await store().openPage('no-such-page')
    expect(store().editor).toBeNull()
    expect(store().error).toMatch(/no-such-page/)
  })
})

describe('mappings', () => {
  const placement = {
    compositionId: 'basic-plan-tile',
    pageTemplateId: 'pdp-mock',
    slotId: 'plan-summary',
    position: 0,
  }

  test('selecting no page falls back to the first one', async () => {
    await store().selectMappingsPage()
    expect(store().mappingsPageId).toBe('pdp-mock')
    expect(authoring.placementsForPage).toHaveBeenCalledWith('pdp-mock')
  })

  test('with no pages at all there is nothing to select', async () => {
    authoring.listPageTemplates.mockResolvedValue([])
    await store().selectMappingsPage()
    expect(store().mappingsPageId).toBeNull()
    expect(store().placements).toEqual([])
  })

  test('setting a placement adopts the list the server returns', async () => {
    authoring.setPlacement.mockResolvedValue([placement])
    await store().selectMappingsPage('pdp-mock')
    await store().setPlacement(placement)
    expect(store().placements).toEqual([placement])
    expect(store().placementsBusy).toBe(false)
  })

  // Otherwise the new tab only appears after the designer reopens the task.
  test('a placement change makes the open task re-read its mapping', async () => {
    await store().selectMappingsPage('pdp-mock')
    await store().setPlacement(placement)
    expect(task.reloadMapping).toHaveBeenCalledTimes(1)

    await store().removePlacement(placement)
    expect(task.reloadMapping).toHaveBeenCalledTimes(2)
  })

  test('removing a placement re-reads the page it belonged to', async () => {
    authoring.placementsForPage.mockResolvedValue([placement])
    await store().selectMappingsPage('pdp-mock')
    authoring.placementsForPage.mockResolvedValue([])
    await store().removePlacement(placement)
    expect(authoring.deletePlacement).toHaveBeenCalledWith(placement)
    expect(store().placements).toEqual([])
  })

  test('a rejected placement is reported and clears the busy flag', async () => {
    authoring.setPlacement.mockRejectedValue(new Error('PUT /v1/authoring/placements failed (400)'))
    await store().selectMappingsPage('pdp-mock')
    await store().setPlacement({ ...placement, slotId: 'no-such-slot' })
    expect(store().error).toMatch(/400/)
    expect(store().placementsBusy).toBe(false)
  })

  // A slow reply for a page the designer has already switched away from.
  test('a reply for a page that is no longer selected does not replace the list', async () => {
    authoring.placementsForPage.mockImplementation(async (id: string) =>
      id === 'pdp-mock' ? [placement] : [],
    )
    await store().selectMappingsPage('pdp-mock')
    expect(store().placements).toEqual([placement])

    await store().setPlacement({ ...placement, pageTemplateId: 'another-page' })
    expect(store().placements).toEqual([placement])
  })
})

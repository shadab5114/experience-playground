import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import basicPlanTile from '../../mocks/compositions/basic-plan-tile.json'
import type { A2UIDocument } from '../../a2ui/types'

const { authoring, repo } = vi.hoisted(() => ({
  authoring: {
    listCompositions: vi.fn(),
    listFlows: vi.fn(),
    listPageTemplates: vi.fn(),
    listVersions: vi.fn(),
    validate: vi.fn(),
    compositionDeleteImpact: vi.fn(),
    deleteComposition: vi.fn(),
    saveComposition: vi.fn(),
    importSamples: vi.fn(),
  },
  repo: { getMapping: vi.fn() },
}))

vi.mock('../../services/createServices', () => ({ services: { authoring, repository: repo } }))

import { useStudioStore } from './studioStore'
import { StudioView } from './StudioView'

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

beforeEach(() => {
  vi.clearAllMocks()
  window.location.hash = ''
  useStudioStore.setState({
    loaded: true,
    loading: false,
    error: null,
    compositions: [record],
    flows: [],
    pages: [],
    editor: null,
    pendingDelete: null,
    notice: null,
  })
  authoring.listCompositions.mockResolvedValue([record])
  authoring.listFlows.mockResolvedValue([])
  authoring.listPageTemplates.mockResolvedValue([])
  authoring.listVersions.mockResolvedValue([])
  authoring.validate.mockResolvedValue({ errors: [], warnings: [] })
  repo.getMapping.mockResolvedValue({ compositionId: 'basic-plan-tile', appearsIn: [] })
})

describe('the compositions list', () => {
  test('shows each record with its derived facts and a Sample chip', () => {
    render(<StudioView section="compositions" />)
    expect(screen.getByText('Basic Plan – Mobile')).toBeInTheDocument()
    expect(screen.getByText('Sample')).toBeInTheDocument()
    expect(screen.getByText(/Basic Plan Tile · Mobile version of the basic plan/)).toBeInTheDocument()
  })

  test('opening a record deep-links to it', () => {
    render(<StudioView section="compositions" />)
    fireEvent.click(screen.getByRole('button', { name: /Basic Plan – Mobile/ }))
    expect(window.location.hash).toBe('#/studio/compositions/basic-plan-tile')
  })
})

describe('the type field', () => {
  const summaryTile = { ...record, compositionId: 'order-summary-tile', name: 'Order Summary', type: 'summary-tile' }

  test('offers the types already in use, derived from the data', async () => {
    useStudioStore.setState({ compositions: [record, summaryTile] })
    await useStudioStore.getState().openComposition('basic-plan-tile')
    render(<StudioView section="compositions" id="basic-plan-tile" />)

    const select = screen.getByLabelText('type')
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'plan-tile',
      'summary-tile',
      'New type…',
    ])
  })

  test('“New type…” turns the field into a text box so any type can be named', async () => {
    useStudioStore.setState({ compositions: [record] })
    await useStudioStore.getState().openComposition('basic-plan-tile')
    render(<StudioView section="compositions" id="basic-plan-tile" />)

    fireEvent.change(screen.getByLabelText('type'), { target: { value: '__new__' } })
    const input = screen.getByRole('textbox', { name: 'New type' })
    expect(input).toHaveValue('')

    fireEvent.change(input, { target: { value: 'Compare Model' } })
    const editor = useStudioStore.getState().editor
    expect(editor?.kind === 'composition' && editor.form.type).toBe('Compare Model')
  })
})

describe('the mappings section', () => {
  test('says a mapping needs a page before it can exist', () => {
    useStudioStore.setState({ pages: [] })
    render(<StudioView section="mappings" />)
    expect(screen.getByText(/there has to be a page first/)).toBeInTheDocument()
  })
})

// Q2 in docs/AUTHORING_UI_PLAN.md: the counts have to be visible before the
// click, because cascading away version history cannot be undone.
describe('the delete confirmation', () => {
  test('names what cascades, warns about history, and says a sample can be re-imported', () => {
    useStudioStore.setState({
      pendingDelete: {
        kind: 'composition' as const,
        id: 'basic-plan-tile',
        impact: { origin: 'sample', placements: 3, savedVersions: 7 },
      },
    })
    render(<StudioView section="compositions" />)

    const dialog = screen.getByRole('dialog', { name: 'Delete basic-plan-tile?' })
    expect(within(dialog).getByText('3 placements')).toBeInTheDocument()
    expect(within(dialog).getByText('7 saved versions')).toBeInTheDocument()
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument()
    expect(within(dialog).getByText(/can bring the record back/)).toBeInTheDocument()
  })

  test('an authored record is told it is gone for good', () => {
    useStudioStore.setState({
      pendingDelete: {
        kind: 'composition' as const,
        id: 'studio-tile',
        impact: { origin: 'authored', placements: 0, savedVersions: 0 },
      },
    })
    render(<StudioView section="compositions" />)

    const dialog = screen.getByRole('dialog', { name: 'Delete studio-tile?' })
    expect(within(dialog).getByText(/will not bring it back/)).toBeInTheDocument()
    expect(within(dialog).getByText('Nothing else points at this record.')).toBeInTheDocument()
    // No history to lose, so no irreversibility warning.
    expect(within(dialog).queryByText(/cannot be undone/)).not.toBeInTheDocument()
  })

  test('counts are singular when there is one of something', () => {
    useStudioStore.setState({
      pendingDelete: {
        kind: 'composition' as const,
        id: 'basic-plan-tile',
        impact: { origin: 'sample', placements: 1, savedVersions: 1 },
      },
    })
    render(<StudioView section="compositions" />)
    expect(screen.getByText('1 placement')).toBeInTheDocument()
    expect(screen.getByText('1 saved version')).toBeInTheDocument()
  })

  test('Cancel holds focus, so a stray Enter cannot delete', () => {
    useStudioStore.setState({
      pendingDelete: {
        kind: 'composition' as const,
        id: 'basic-plan-tile',
        impact: { origin: 'sample', placements: 0, savedVersions: 4 },
      },
    })
    render(<StudioView section="compositions" />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  test('confirming deletes; cancelling does not', () => {
    authoring.deleteComposition.mockResolvedValue(undefined)
    useStudioStore.setState({
      pendingDelete: {
        kind: 'composition' as const,
        id: 'basic-plan-tile',
        impact: { origin: 'authored', placements: 0, savedVersions: 0 },
      },
    })
    const { rerender } = render(<StudioView section="compositions" />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(authoring.deleteComposition).not.toHaveBeenCalled()

    useStudioStore.setState({
      pendingDelete: {
        kind: 'composition' as const,
        id: 'basic-plan-tile',
        impact: { origin: 'authored', placements: 0, savedVersions: 0 },
      },
    })
    rerender(<StudioView section="compositions" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(authoring.deleteComposition).toHaveBeenCalledWith('basic-plan-tile')
  })
})

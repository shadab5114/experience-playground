import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { A2UIRenderer } from './A2UIRenderer'
import { SurfaceRegistryProvider } from './SurfaceRegistry'
import { getMessageSurfaceId, pageSurfaceId, rekeySurface, slotSurfaceId } from '../rekeySurface'
import type { A2UIDocument } from '../types'
import basicPlanFixture from '../../mocks/compositions/basic-plan-tile.json'

/**
 * Proves the "surfaceId is always 'main' in a composition fixture — how
 * does that work hosted in a page?" concern is actually resolved, using a
 * REAL fixture (not a hand-built document), the same way the eventual
 * Impacts view loading step would: rekey the composition's messages from
 * "main" to its slot's surfaceId, then register it.
 */
describe('slot hosting integration — a real "main"-keyed composition fixture, rekeyed into a page slot', () => {
  it('renders the real Basic Plan tile fixture inside a page, with its surfaceId rewritten from "main" to the slot key', () => {
    const pageId = 'pdp-mock'
    const slotId = 'plan-summary'

    // The fixture as authored/stored: every message's surfaceId is "main".
    const composition = basicPlanFixture.a2ui as A2UIDocument
    expect(composition.a2ui.every((m) => getMessageSurfaceId(m) === 'main')).toBe(true)

    // What the Impacts loading step would do: rekey to the slot's surfaceId.
    const rekeyedMessages = rekeySurface(composition.a2ui, slotSurfaceId(pageId, slotId))
    const rekeyedComposition: A2UIDocument = { meta: composition.meta, a2ui: rekeyedMessages }
    expect(rekeyedMessages.every((m) => getMessageSurfaceId(m) === slotSurfaceId(pageId, slotId))).toBe(true)

    const pageDocument: A2UIDocument = {
      a2ui: [
        { version: 'v0.9', createSurface: { surfaceId: pageSurfaceId(pageId), catalogId: composition.meta!.catalogId } },
        { version: 'v0.9', updateDataModel: { surfaceId: pageSurfaceId(pageId), path: '/', value: {} } },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: pageSurfaceId(pageId),
            components: [{ id: 'root', component: 'Slot', slotId }],
          },
        },
      ],
    }

    const registry = new Map([
      [pageSurfaceId(pageId), pageDocument],
      [slotSurfaceId(pageId, slotId), rekeyedComposition],
    ])

    render(<A2UIRenderer surfaceId={pageSurfaceId(pageId)} />, {
      wrapper: ({ children }) => <SurfaceRegistryProvider registry={registry}>{children}</SurfaceRegistryProvider>,
    })

    // The real tile, rendered inside the page via its slot.
    expect(screen.getByText('Most Popular')).toBeInTheDocument()
    expect(screen.getByText('Basic Plan')).toBeInTheDocument()
    expect(screen.getByText('$30/mo')).toBeInTheDocument()
  })

  it('shows "Empty slot" if the composition was registered under its original "main" key instead of being rekeyed', () => {
    const pageId = 'pdp-mock'
    const slotId = 'plan-summary'
    const composition = basicPlanFixture.a2ui as A2UIDocument

    const pageDocument: A2UIDocument = {
      a2ui: [
        { version: 'v0.9', createSurface: { surfaceId: pageSurfaceId(pageId), catalogId: composition.meta!.catalogId } },
        { version: 'v0.9', updateDataModel: { surfaceId: pageSurfaceId(pageId), path: '/', value: {} } },
        { version: 'v0.9', updateComponents: { surfaceId: pageSurfaceId(pageId), components: [{ id: 'root', component: 'Slot', slotId }] } },
      ],
    }

    // Forgot to rekey — registered under the composition's own original "main" surfaceId.
    const registry = new Map([
      [pageSurfaceId(pageId), pageDocument],
      ['main', composition],
    ])

    render(<A2UIRenderer surfaceId={pageSurfaceId(pageId)} />, {
      wrapper: ({ children }) => <SurfaceRegistryProvider registry={registry}>{children}</SurfaceRegistryProvider>,
    })

    expect(screen.getByText(/Empty slot: plan-summary/)).toBeInTheDocument()
    expect(screen.queryByText('Basic Plan')).not.toBeInTheDocument()
  })
})

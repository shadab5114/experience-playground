import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { A2UIRenderer } from './A2UIRenderer'
import { SurfaceRegistryProvider } from './SurfaceRegistry'
import type { A2UIDocument } from '../types'

const CATALOG_ID = 'https://pdesign.dev/catalog/v1/catalog.json'

describe('A2UIRenderer — ChildList (pds-core 1.0.0-alpha.10)', () => {
  it('renders a Stack’s static children by id', () => {
    const document: A2UIDocument = {
      a2ui: [
        { version: 'v0.9', createSurface: { surfaceId: 'main', catalogId: CATALOG_ID } },
        { version: 'v0.9', updateDataModel: { surfaceId: 'main', path: '/', value: { plan: { name: 'Basic Plan' } } } },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'main',
            components: [
              { id: 'root', component: 'Stack', direction: 'row', gap: '12px', children: ['badge', 'title'] },
              { id: 'badge', component: 'Badge', backgroundColor: 'red', children: 'Most Popular' },
              { id: 'title', component: 'Text', kind: 'title', children: { path: '/plan/name' } },
            ],
          },
        },
      ],
    }

    render(<A2UIRenderer document={document} />)

    expect(screen.getByText('Most Popular')).toBeInTheDocument()
    expect(screen.getByText('Basic Plan')).toBeInTheDocument()
  })

  it('renders a dynamic-list template (componentId + path) once per item, with bindings relative to each item (no leading slash)', () => {
    const document: A2UIDocument = {
      a2ui: [
        { version: 'v0.9', createSurface: { surfaceId: 'main', catalogId: CATALOG_ID } },
        { version: 'v0.9', updateDataModel: { surfaceId: 'main', path: '/', value: { lines: [{ label: 'Line 1' }, { label: 'Line 2' }] } } },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'main',
            components: [
              { id: 'root', component: 'Stack', direction: 'column', children: { componentId: 'lineItem', path: '/lines' } },
              { id: 'lineItem', component: 'Text', children: { path: 'label' } },
            ],
          },
        },
      ],
    }

    render(<A2UIRenderer document={document} />)

    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.getByText('Line 2')).toBeInTheDocument()
  })

  it('resolves a NESTED template’s path relative to its own enclosing item, not the outer item or the root', () => {
    // root -> plan-row (list over /plans, template: plan-tile)
    //   plan-tile -> plan-features (list over "features", relative to the plan item; template: plan-feature)
    //     plan-feature -> text bound to "text" (relative to the feature item)
    const document: A2UIDocument = {
      a2ui: [
        { version: 'v0.9', createSurface: { surfaceId: 'main', catalogId: CATALOG_ID } },
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId: 'main',
            path: '/',
            value: {
              plans: [
                { name: 'Plan A', features: [{ text: 'A-feature-1' }, { text: 'A-feature-2' }] },
                { name: 'Plan B', features: [{ text: 'B-feature-1' }] },
              ],
            },
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'main',
            components: [
              { id: 'root', component: 'Stack', direction: 'row', children: { componentId: 'plan-tile', path: '/plans' } },
              { id: 'plan-tile', component: 'Stack', direction: 'column', children: ['plan-name', 'plan-features'] },
              { id: 'plan-name', component: 'Text', kind: 'title', children: { path: 'name' } },
              { id: 'plan-features', component: 'Stack', direction: 'column', children: { componentId: 'plan-feature', path: 'features' } },
              { id: 'plan-feature', component: 'Text', kind: 'body', children: { path: 'text' } },
            ],
          },
        },
      ],
    }

    render(<A2UIRenderer document={document} />)

    expect(screen.getByText('Plan A')).toBeInTheDocument()
    expect(screen.getByText('Plan B')).toBeInTheDocument()
    expect(screen.getByText('A-feature-1')).toBeInTheDocument()
    expect(screen.getByText('A-feature-2')).toBeInTheDocument()
    expect(screen.getByText('B-feature-1')).toBeInTheDocument()
    // If the nested path were wrongly absolute (e.g. hardcoded to
    // /plans/0/features), both tiles would render Plan A's two features and
    // the getByText('B-feature-1') call above would never have matched
    // (Plan B's tile would show "A-feature-1"/"A-feature-2" instead).
  })

  it('still shows the Unsupported box for an unknown component type (regression check)', () => {
    const document: A2UIDocument = {
      a2ui: [
        { version: 'v0.9', createSurface: { surfaceId: 'main', catalogId: CATALOG_ID } },
        { version: 'v0.9', updateDataModel: { surfaceId: 'main', path: '/', value: {} } },
        { version: 'v0.9', updateComponents: { surfaceId: 'main', components: [{ id: 'root', component: 'TotallyMadeUpComponent' }] } },
      ],
    }

    render(<A2UIRenderer document={document} />)

    expect(screen.getByText(/Unsupported component: TotallyMadeUpComponent/)).toBeInTheDocument()
  })
})

describe('A2UIRenderer — Slot (impact-pages-slot-hosting groundwork)', () => {
  const pageDocument: A2UIDocument = {
    a2ui: [
      { version: 'v0.9', createSurface: { surfaceId: 'page:pdp-mock', catalogId: CATALOG_ID } },
      { version: 'v0.9', updateDataModel: { surfaceId: 'page:pdp-mock', path: '/', value: {} } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'page:pdp-mock',
          components: [{ id: 'root', component: 'Slot', slotId: 'plan-summary' }],
        },
      },
    ],
  }

  it('shows "Empty slot" when nothing is registered at the derived slot surfaceId', () => {
    render(<A2UIRenderer surfaceId="page:pdp-mock" />, {
      wrapper: ({ children }) => <SurfaceRegistryProvider registry={new Map([['page:pdp-mock', pageDocument]])}>{children}</SurfaceRegistryProvider>,
    })

    expect(screen.getByText(/Empty slot: plan-summary/)).toBeInTheDocument()
  })

  it('renders the composition registered at slot:<pageId>:<slotId>, independently of the page document', () => {
    const compositionDocument: A2UIDocument = {
      a2ui: [
        { version: 'v0.9', createSurface: { surfaceId: 'slot:pdp-mock:plan-summary', catalogId: CATALOG_ID } },
        { version: 'v0.9', updateDataModel: { surfaceId: 'slot:pdp-mock:plan-summary', path: '/', value: { name: 'Basic Plan' } } },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'slot:pdp-mock:plan-summary',
            components: [{ id: 'root', component: 'Text', children: { path: '/name' } }],
          },
        },
      ],
    }

    const registry = new Map([
      ['page:pdp-mock', pageDocument],
      ['slot:pdp-mock:plan-summary', compositionDocument],
    ])

    render(<A2UIRenderer surfaceId="page:pdp-mock" />, {
      wrapper: ({ children }) => <SurfaceRegistryProvider registry={registry}>{children}</SurfaceRegistryProvider>,
    })

    expect(screen.getByText('Basic Plan')).toBeInTheDocument()
  })
})

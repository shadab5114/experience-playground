import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import showcase from '../../mocks/compositions/catalog-showcase-tile.json'
import { catalog } from '../schema'
import type { A2UIDocument } from '../types'
import { resolveSurface } from '../resolveSurface'
import { A2UIRenderer } from './A2UIRenderer'

/**
 * The showcase fixture's contract: one rendered instance of *every* component
 * in pds-core's catalog.json, so A2UI generation and rendering is exercised
 * across the whole catalog rather than the handful of components the three
 * tile fixtures happen to use. When a pds-core upgrade adds a component,
 * `covers every component` fails until the fixture catches up — that's the
 * point of the test, not an inconvenience.
 */
const document = showcase.a2ui as unknown as A2UIDocument
const surface = resolveSurface(document)
const catalogComponents = Object.keys(
  (catalog as unknown as { components: Record<string, unknown> }).components,
)

function componentsUsed(): Set<string> {
  const used = new Set<string>()
  for (const node of surface.componentsById.values()) used.add(node.component)
  return used
}

describe('catalog showcase fixture', () => {
  test('covers every component in the catalog', () => {
    const used = componentsUsed()
    const missing = catalogComponents.filter((name) => !used.has(name))
    expect(missing, `not in the showcase fixture: ${missing.join(', ')}`).toEqual([])
  })

  test('uses no component the catalog does not define', () => {
    const unknown = [...componentsUsed()].filter((name) => !catalogComponents.includes(name))
    expect(unknown).toEqual([])
  })

  test('meta.components matches what the document actually uses', () => {
    expect(document.meta?.components).toBeDefined()
    expect([...(document.meta?.components ?? [])].sort()).toEqual([...componentsUsed()].sort())
  })

  test('every referenced node id exists', () => {
    const dangling: string[] = []
    // ChildList appears in nested prop objects too (cap/header/footer
    // children, an Accordion's items), so this walks the whole node.
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item)
        return
      }
      if (!value || typeof value !== 'object') return
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'children' && Array.isArray(inner)) {
          for (const id of inner) {
            if (typeof id === 'string' && !surface.componentsById.has(id)) dangling.push(id)
          }
        } else if (key === 'children' && inner && typeof inner === 'object' && 'componentId' in inner) {
          const { componentId } = inner as { componentId: string }
          if (!surface.componentsById.has(componentId)) dangling.push(componentId)
        } else {
          walk(inner)
        }
      }
    }
    for (const node of surface.componentsById.values()) walk(node)
    expect(dangling).toEqual([])
  })

  test('icon slots resolve to real icons', () => {
    const { container } = render(<A2UIRenderer document={document} />)
    // IconButton's `icon` is bridged to pds-core's renderIcon function, and
    // ListGroupItem/Notification take elements — all should paint an svg.
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(3)
    expect(screen.getByLabelText('Notifications').querySelector('svg')).toBeTruthy()
  })

  test('renders without any unsupported or missing-node fallback', () => {
    render(<A2UIRenderer document={document} />)
    // Every fallback box in A2UIRenderer is role="alert" with an
    // "Unsupported component: X" / "Missing component: X" label.
    expect(screen.queryAllByRole('alert').map((el) => el.textContent)).toEqual([])
  })

  test('resolves bindings, including the non-string Dynamic* ones', () => {
    render(<A2UIRenderer document={document} />)

    // DynamicString binding -> /page/title
    expect(screen.getByText('Catalog coverage showcase')).toBeTruthy()
    // DynamicString binding inside a nested prop object -> Tilelet.subtitle.children
    expect(screen.getByText('Included for 6 months')).toBeTruthy()
    // /tile/title is bound twice (Tilelet.title and lgiPlan.subtitle) — the
    // same path resolving in two unrelated nested prop objects.
    expect(screen.getAllByText('Disney+ on us')).toHaveLength(2)
    // DynamicBoolean binding -> Toggle.checked from /prefs/autopay (true).
    // With showStatusText the accessible name is the visible status text.
    expect(screen.getByRole('switch', { name: /Autopay on/ })).toBeChecked()
    // The same, bound to `false` inside a nested prop object
    // (ListGroupItem.toggle.checked -> /prefs/paperless).
    expect(screen.getByRole('switch', { name: 'Paperless billing' })).not.toBeChecked()
    // A ChildList template over /perks, one Badge per item
    expect(screen.getByText('Mobile hotspot')).toBeTruthy()
    expect(screen.getByText('Travel pass')).toBeTruthy()
  })

  test('group selection comes from the group, not the item', () => {
    render(<A2UIRenderer document={document} />)
    // A grouped Checkbox/RadioButton ignores its own `checked`: the group's
    // bound `value` decides. Easy to get wrong in a generated document, so
    // it's pinned here.
    expect(screen.getByRole('checkbox', { name: /Music Unlimited/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Cloud storage/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Monthly/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Annual/ })).not.toBeChecked()
  })

  test('resolves a ChildList nested inside a prop array (Accordion.items[].children)', () => {
    render(<A2UIRenderer document={document} />)
    // The panel bodies are separate component nodes referenced from each
    // `items` entry — they only appear if ChildList resolves at that depth.
    expect(screen.getByText('Unlimited talk and text, plus 5G data on a compatible device.')).toBeTruthy()
    expect(screen.getByText('Charged monthly, starting on your next bill cycle.')).toBeTruthy()
  })

  test('Modal renders its content when its bound `opened` flag is true', () => {
    // The fixture ships /ui/modalOpen false so the showcase isn't covered by
    // an overlay; flipping it is what proves the Modal branch renders.
    const opened = structuredClone(document)
    const update = opened.a2ui.find((message) => 'updateDataModel' in message)
    const model = (update as { updateDataModel: { value: { ui: { modalOpen: boolean } } } })
      .updateDataModel.value
    model.ui.modalOpen = true

    render(<A2UIRenderer document={opened} />)
    expect(screen.getByText('Confirm change')).toBeTruthy()
    expect(screen.getByText('The tile will update in PDP, AAL and Order Summary.')).toBeTruthy()
    expect(screen.queryAllByRole('alert').map((el) => el.textContent)).toEqual([])
  })
})

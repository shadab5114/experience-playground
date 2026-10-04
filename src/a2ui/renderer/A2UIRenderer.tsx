import { createElement, type ReactNode } from 'react'
import type { A2UIComponentNode, A2UIDocument } from '../types'
import { resolveSurface, type ResolvedSurface } from '../resolveSurface'
import { getComponentPropertySchemas, isComponentKnown, isIconNameRef, type JsonSchemaLike } from '../schema'
import { resolvePath, resolveValue } from './resolveValue'
import { iconRenderFunction, renderIconElement } from './icons'
import { getRegisteredComponent } from './registry'
import { useSurfaceDocument } from './useSurfaceDocument'
import styles from './A2UIRenderer.module.css'

interface A2UIRendererProps {
  /** Render this document directly — the common case (the preview pane, a standalone composition). */
  document?: A2UIDocument
  /**
   * Render whatever document is registered under this surfaceId instead
   * (docs/decisions/impact-pages-slot-hosting.md). Also doubles as the
   * surface's own identity while rendering, so a `Slot` node inside a page
   * surface (`page:<id>`) can derive the page id and host its composition
   * at `slot:<id>:<slotId>`.
   */
  surfaceId?: string
}

/**
 * Renders an A2UI document (the real wire envelope — `meta` + an ordered
 * `a2ui` message log) as real VDS (pds-core) components. Resolves the
 * message log into one surface, then walks it from `"root"`, resolving
 * each node's props against the catalog schema (so a prop bound to the
 * data model, e.g. `{ path: "/plan/name" }`, becomes the live string)
 * before handing them to the matching pds-core component.
 *
 * Every rendered element comes from this registry — nothing about a tile's
 * layout is hardcoded here.
 */
export function A2UIRenderer({ document, surfaceId }: A2UIRendererProps) {
  const fromRegistry = useSurfaceDocument(surfaceId)
  const resolved = document ?? fromRegistry
  if (!resolved) {
    return <UnsupportedBox label={`Missing surface: ${surfaceId}`} />
  }
  const surface = resolveSurface(resolved)
  return <>{renderNode('root', surface, surface.dataModel, surfaceId)}</>
}

/**
 * pds-core's `IconButton` still takes render *functions* (`renderIcon`,
 * `renderSelectedIcon`), while the catalog — correctly, since JSON can hold
 * neither a function nor an element — declares plain `IconName` strings
 * under `icon`/`selectedIcon`. This table bridges the two names and shapes.
 *
 * It is the only place in the renderer that names a specific component's
 * React API; every other icon slot takes a ReactNode and needs no entry.
 * Delete an entry once pds-core accepts the catalog's prop directly.
 */
const iconRenderPropBridge: Record<string, Record<string, string>> = {
  IconButton: { icon: 'renderIcon', selectedIcon: 'renderSelectedIcon' },
}

/** Builds the resolved props for a node (shared by `renderNode` and template instances). */
function resolveProps(
  node: A2UIComponentNode,
  propertySchemas: Record<string, JsonSchemaLike>,
  surface: ResolvedSurface,
  currentContext: unknown,
  pageSurfaceId: string | undefined,
): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  // One context for the whole node: `resolveValue` applies these callbacks
  // at every ChildList/IconName it meets, including ones nested inside a
  // prop object or array (`Accordion.items[].children`). Nested prop objects
  // never introduce a new binding context, so closing over this node's
  // `currentContext` is correct at any depth.
  const ctx = {
    dataModel: surface.dataModel,
    currentContext,
    renderChildList: (value: unknown) => resolveChildList(value, surface, currentContext, pageSurfaceId),
    renderIcon: renderIconElement,
  }
  const bridge = iconRenderPropBridge[node.component] ?? {}

  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'component') continue
    const propSchema = propertySchemas[key]
    const bridgedKey = bridge[key]
    if (bridgedKey && isIconNameRef(propSchema)) {
      props[bridgedKey] = resolveValue(propSchema, value, { ...ctx, renderIcon: iconRenderFunction })
      continue
    }
    props[key] = resolveValue(propSchema, value, ctx)
  }
  return props
}

/**
 * `currentContext` is the binding root for a relative (no leading `/`)
 * path — see `resolvePath`. `pageSurfaceId` is the enclosing page's own
 * surfaceId (only set while rendering a page document), threaded through
 * unchanged so a nested `Slot` can compute its target surface.
 */
function renderNode(id: string, surface: ResolvedSurface, currentContext: unknown, pageSurfaceId: string | undefined): ReactNode {
  const node = surface.componentsById.get(id)
  if (!node) {
    return <UnsupportedBox key={id} label={`Missing component: ${id}`} />
  }
  return renderComponentNode(node, surface, currentContext, id, pageSurfaceId)
}

function renderComponentNode(
  node: A2UIComponentNode,
  surface: ResolvedSurface,
  currentContext: unknown,
  reactKey: string,
  pageSurfaceId: string | undefined,
): ReactNode {
  // Slot is playground-native, not a VDS catalog component — handle it before any catalog lookup.
  if (node.component === 'Slot') {
    return <SlotNode key={reactKey} node={node} pageSurfaceId={pageSurfaceId} />
  }

  if (!isComponentKnown(node.component)) {
    return <UnsupportedBox key={reactKey} label={`Unsupported component: ${node.component}`} />
  }

  const Component = getRegisteredComponent(node.component)
  if (!Component) {
    return <UnsupportedBox key={reactKey} label={`Unsupported component: ${node.component}`} />
  }

  const propertySchemas = getComponentPropertySchemas(node.component) ?? {}
  const props = resolveProps(node, propertySchemas, surface, currentContext, pageSurfaceId)
  return createElement(Component, { key: reactKey, ...props })
}

/**
 * Hosts the composition placed in this page slot as its own, independent
 * surface — never merged into the page document (no id prefixing, no data
 * path rewriting; docs/decisions/impact-pages-slot-hosting.md). Shows a
 * visible "Empty slot: <slotId>" box whenever there's nothing to render:
 * no enclosing page surface to derive the target from, or nothing
 * registered at that surfaceId yet.
 */
function SlotNode({ node, pageSurfaceId }: { node: A2UIComponentNode; pageSurfaceId: string | undefined }) {
  const slotId = typeof node.slotId === 'string' ? node.slotId : undefined
  const pageId = pageSurfaceId?.startsWith('page:') ? pageSurfaceId.slice('page:'.length) : undefined
  const targetSurfaceId = slotId && pageId ? `slot:${pageId}:${slotId}` : undefined
  const targetDocument = useSurfaceDocument(targetSurfaceId)

  if (!targetDocument) {
    return (
      <div className={styles.unsupported} role="status">
        Empty slot: {slotId ?? '(unknown)'}
      </div>
    )
  }

  // Stable, non-module-scoped classes + a data attribute — not styled here
  // (a generic renderer shouldn't know about Impacts-specific chrome), but a
  // deliberate hook for a host context (the Impacts view) to find this exact
  // DOM position and apply the dashed-outline/"Updated tile" treatment via
  // CSS, per docs/decisions/impact-pages-slot-hosting.md step 5 ("never
  // inside the composition"). The label is real DOM text (not a CSS ::before
  // — that's invisible to accessibility trees and text-based test queries),
  // default-hidden via src/index.css; a host context opts in by overriding
  // its opacity, same convention as the outline.
  return (
    <div className="a2ui-slot-host" data-slot-id={slotId}>
      <span className="a2ui-slot-label">Updated tile</span>
      <A2UIRenderer document={targetDocument} />
    </div>
  )
}

/**
 * Resolves a `ChildList` prop value: either a static array of component ids
 * (each rendered from `surface.componentsById`, inheriting the current
 * context — they're structural siblings, not per-item bindings), or a
 * `{ componentId, path }` template repeated once per item in the array at
 * `path`. `path` itself resolves against the *current* context (so a list
 * nested inside another template's item is relative to that item, not the
 * surface root), and each rendered instance's own bindings resolve
 * relative to its own item in turn.
 */
function resolveChildList(
  value: unknown,
  surface: ResolvedSurface,
  currentContext: unknown,
  pageSurfaceId: string | undefined,
): ReactNode {
  if (Array.isArray(value)) {
    return value
      .filter((childId): childId is string => typeof childId === 'string')
      .map((childId) => renderNode(childId, surface, currentContext, pageSurfaceId))
  }

  if (value && typeof value === 'object' && 'componentId' in value && 'path' in value) {
    const { componentId, path } = value as { componentId: string; path: string }
    const items = resolvePath(path, surface.dataModel, currentContext)
    if (!Array.isArray(items)) return null

    const templateNode = surface.componentsById.get(componentId)
    if (!templateNode) {
      return <UnsupportedBox key={componentId} label={`Missing template component: ${componentId}`} />
    }

    return items.map((item, index) => {
      const itemContext = item && typeof item === 'object' ? item : { value: item }
      return renderComponentNode(templateNode, surface, itemContext, `${componentId}-${index}`, pageSurfaceId)
    })
  }

  return null
}

function UnsupportedBox({ label }: { label: string }) {
  return (
    <div className={styles.unsupported} role="alert">
      {label}
    </div>
  )
}

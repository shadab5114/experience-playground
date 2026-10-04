import { derefSchema, isChildListRef, isDynamicRef, isIconNameRef, type JsonSchemaLike } from '../schema'

/** Resolves a JSON Pointer (RFC 6901) path like `/plan/name` against a root value. */
export function getByJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return root
  const parts = pointer.split('/').slice(1).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  let current: unknown = root
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Resolves a binding path against either the absolute data model or the
 * current binding context, per the real A2UI convention: a path starting
 * with `/` is absolute (always from the surface's root data model); a path
 * with no leading slash is relative to the nearest enclosing context —
 * the root data model at the top level, or the current item when inside a
 * list-template (`ChildList`'s `{ componentId, path }` form), at any
 * nesting depth (a template nested inside a template is relative to its
 * own immediate item, not the outermost one).
 */
export function resolvePath(path: string, dataModel: Record<string, unknown>, currentContext: unknown): unknown {
  if (path.startsWith('/')) return getByJsonPointer(dataModel, path)
  return getByJsonPointer(currentContext, '/' + path)
}

function isDataBinding(value: unknown): value is { path: string } {
  return typeof value === 'object' && value !== null && 'path' in value && typeof (value as { path: unknown }).path === 'string'
}

/**
 * What a prop resolves against. The two render callbacks are supplied by the
 * renderer, which owns node lookup and JSX, so this module stays free of
 * both; without them, those props pass through untouched.
 */
export interface ResolveContext {
  dataModel: Record<string, unknown>
  /** Binding root for a relative (no leading `/`) path — see `resolvePath`. */
  currentContext: unknown
  renderChildList?: (value: unknown) => unknown
  renderIcon?: (value: unknown) => unknown
}

/**
 * Resolves one prop value against its catalog schema and the composition's
 * data model. Generic over the whole catalog: it never hardcodes a specific
 * component's prop shape, only the five schema patterns the catalog uses —
 * a `Dynamic*` binding, a `ChildList`, an `IconName`, a nested object/array
 * `$ref`, or a plain static value.
 *
 * `ChildList` and `IconName` are resolved at *any* depth, not just a node's
 * own props: `Accordion.items[]` entries carry their own `children`, and
 * `ListGroupItem.toggle` its own bindings.
 */
export function resolveValue(schema: JsonSchemaLike | undefined, value: unknown, ctx: ResolveContext): unknown {
  if (value === undefined) return undefined

  if (isDynamicRef(schema)) {
    if (isDataBinding(value)) return resolvePath(value.path, ctx.dataModel, ctx.currentContext)
    return value
  }

  if (isChildListRef(schema)) {
    return ctx.renderChildList ? ctx.renderChildList(value) : value
  }

  if (isIconNameRef(schema)) {
    // An icon name may itself be bound, e.g. { path: "/state/statusIcon" }.
    const name = isDataBinding(value) ? resolvePath(value.path, ctx.dataModel, ctx.currentContext) : value
    return ctx.renderIcon ? ctx.renderIcon(name) : name
  }

  const resolved = derefSchema(schema)

  if (resolved?.type === 'array' && Array.isArray(value)) {
    return value.map((item) => resolveValue(resolved.items, item, ctx))
  }

  if (resolved?.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = resolveValue(resolved.properties[key], nested, ctx)
    }
    return result
  }

  // No schema info, or a plain static value (enum/string/boolean/number): pass through.
  return value
}

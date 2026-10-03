import { derefSchema, isDynamicStringRef, type JsonSchemaLike } from '../schema'

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
 * Resolves one prop value against its catalog schema, the composition's
 * data model, and the current binding context. Generic over the whole
 * catalog: it never hardcodes a specific component's prop shape, only the
 * three schema patterns the catalog uses (DynamicString, a nested object
 * $ref, a plain static value).
 */
export function resolveValue(
  schema: JsonSchemaLike | undefined,
  value: unknown,
  dataModel: Record<string, unknown>,
  currentContext: unknown,
): unknown {
  if (value === undefined) return undefined

  if (isDynamicStringRef(schema)) {
    if (isDataBinding(value)) return resolvePath(value.path, dataModel, currentContext)
    return value
  }

  const resolved = derefSchema(schema)

  if (resolved?.type === 'array' && Array.isArray(value)) {
    return value.map((item) => resolveValue(resolved.items, item, dataModel, currentContext))
  }

  if (resolved?.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = resolveValue(resolved.properties[key], nested, dataModel, currentContext)
    }
    return result
  }

  // No schema info, or a plain static value (enum/string/boolean/number): pass through.
  return value
}

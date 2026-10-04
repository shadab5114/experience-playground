import catalog from '@shadab5114/pds-core/catalog.json'

/**
 * Minimal JSON Schema shape we actually read from the catalog. The catalog
 * is JSON Schema 2020-12; we only need `$ref`, `allOf`, `properties`, `type`
 * and `oneOf` to walk it.
 */
export interface JsonSchemaLike {
  $ref?: string
  allOf?: JsonSchemaLike[]
  oneOf?: JsonSchemaLike[]
  type?: string
  properties?: Record<string, JsonSchemaLike>
  items?: JsonSchemaLike
  [key: string]: unknown
}

type Catalog = typeof catalog

const defs = (catalog as Catalog).$defs as unknown as Record<string, JsonSchemaLike>
const components = (catalog as Catalog).components as unknown as Record<string, JsonSchemaLike>

export const catalogId: string = (catalog as Catalog).catalogId

/** Dereferences a single `$ref` like `"#/$defs/BadgeProps"` against the catalog's `$defs`. */
export function derefSchema(schema: JsonSchemaLike | undefined): JsonSchemaLike | undefined {
  if (!schema) return undefined
  if (schema.$ref) {
    const name = schema.$ref.replace('#/$defs/', '')
    return defs[name]
  }
  return schema
}

/**
 * Flattens a component's (or $def's) `allOf` into one `properties` map.
 * Catalog components are `allOf: [ComponentCommon, CatalogComponentCommon, { properties: {...} }]`.
 */
export function getMergedProperties(schema: JsonSchemaLike | undefined): Record<string, JsonSchemaLike> {
  if (!schema) return {}
  if (schema.properties) return schema.properties
  if (schema.allOf) {
    return schema.allOf.reduce<Record<string, JsonSchemaLike>>((acc, part) => {
      const resolved = part.$ref ? derefSchema(part) : part
      return { ...acc, ...getMergedProperties(resolved) }
    }, {})
  }
  return {}
}

/** The merged property schemas for a catalog component type, e.g. `"Tilelet"`. */
export function getComponentPropertySchemas(componentType: string): Record<string, JsonSchemaLike> | undefined {
  const schema = components[componentType]
  if (!schema) return undefined
  return getMergedProperties(schema)
}

export function isComponentKnown(componentType: string): boolean {
  return componentType in components
}

/**
 * Every `Dynamic*` $def in the catalog is the same shape: a literal of that
 * type, OR a `DataBinding` (`{ path }`), OR a `FunctionCall`. So a binding
 * is resolvable against any of them, not just `DynamicString` — a
 * `DynamicBoolean` prop like `Modal.opened` or `Toggle.checked` binds the
 * same way.
 */
const dynamicRefs = new Set([
  '#/$defs/DynamicString',
  '#/$defs/DynamicNumber',
  '#/$defs/DynamicBoolean',
  '#/$defs/DynamicValue',
  '#/$defs/DynamicStringList',
])

export function isDynamicRef(schema: JsonSchemaLike | undefined): boolean {
  return typeof schema?.$ref === 'string' && dynamicRefs.has(schema.$ref)
}

export function isChildListRef(schema: JsonSchemaLike | undefined): boolean {
  return schema?.$ref === '#/$defs/ChildList'
}

/**
 * An icon slot. The catalog declares these as a plain kebab-case name from
 * the `IconName` enum (JSON can't carry a React element or a render
 * function), so the renderer resolves the name to a real icon component.
 */
export function isIconNameRef(schema: JsonSchemaLike | undefined): boolean {
  return schema?.$ref === '#/$defs/IconName'
}

export { catalog }

import * as PdsCore from '@shadab5114/pds-core'

type PdsComponent = React.ComponentType<Record<string, unknown>>

const pdsCoreExports = PdsCore as unknown as Record<string, unknown>

/**
 * Looks up a catalog component name directly against pds-core's exports.
 * Every name in catalog.json's `components` map is exported from the
 * package's top level under the same name, so there's no hand-maintained
 * name -> component table to keep in sync.
 */
export function getRegisteredComponent(componentType: string): PdsComponent | undefined {
  const exported = pdsCoreExports[componentType]
  if (exported == null) return undefined
  return exported as PdsComponent
}

import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import * as PdsIcons from '@shadab5114/pds-core/icons'
import { catalog } from '../schema'
import { getIconComponent, iconExportName, iconRenderFunction, renderIconElement } from './icons'

const iconNames = (catalog as unknown as { $defs: { IconName: { enum: string[] } } }).$defs.IconName.enum

describe('IconName resolution', () => {
  test('the catalog enum maps 1:1 onto pds-core icon exports', () => {
    // The kebab -> PascalCase rule is mechanical rather than a maintained
    // table, so this is what guards it across pds-core upgrades.
    const unresolved = iconNames.filter((name) => getIconComponent(name) === undefined)
    expect(unresolved, `no icon export for: ${unresolved.join(', ')}`).toEqual([])
    expect(iconNames.length).toBeGreaterThan(0)
  })

  test('every icon export is reachable from some catalog name', () => {
    const exported = Object.keys(PdsIcons as unknown as Record<string, unknown>).filter(
      (key) => /^[A-Z]/.test(key) && !['IconBase', 'Caret', 'DirectionalIcon', 'ICON_SIZES'].includes(key),
    )
    const reachable = new Set(iconNames.map(iconExportName))
    expect(exported.filter((name) => !reachable.has(name))).toEqual([])
  })

  test('kebab-case converts to the export name', () => {
    expect(iconExportName('bell')).toBe('Bell')
    expect(iconExportName('arrow-down')).toBe('ArrowDown')
    expect(iconExportName('checkmark-alt-bold')).toBe('CheckmarkAltBold')
  })

  test('an unknown name resolves to nothing rather than throwing', () => {
    expect(getIconComponent('not-a-real-icon')).toBeUndefined()
    expect(getIconComponent(undefined)).toBeUndefined()
    expect(getIconComponent('')).toBeUndefined()
    expect(renderIconElement('not-a-real-icon')).toBeNull()
    expect(iconRenderFunction('not-a-real-icon')).toBeUndefined()
  })

  test('renders an svg for a real name, in both element and render-function form', () => {
    const asElement = render(<>{renderIconElement('bell')}</>)
    expect(asElement.container.querySelector('svg')).toBeTruthy()

    const fn = iconRenderFunction('bell')
    expect(fn).toBeTypeOf('function')
    const asFunction = render(<>{fn?.({ size: 20, color: 'red' })}</>)
    expect(asFunction.container.querySelector('svg')).toBeTruthy()
  })
})

import type { ComponentType, ReactNode } from 'react'
import * as PdsIcons from '@shadab5114/pds-core/icons'

/** What pds-core passes to an icon: see `IconProps` in the package. */
export interface IconRenderProps {
  size?: string | number
  color?: string
}

type IconComponent = ComponentType<IconRenderProps>

const iconExports = PdsIcons as unknown as Record<string, unknown>

/**
 * The catalog's `IconName` enum is kebab-case (`arrow-down`), while the
 * package exports PascalCase (`ArrowDown`). The two sets are 1:1 across all
 * 74 icons, so the mapping is mechanical rather than a table to maintain —
 * `icons.test.tsx` asserts that stays true on every pds-core upgrade.
 */
export function iconExportName(iconName: string): string {
  return iconName
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function getIconComponent(iconName: unknown): IconComponent | undefined {
  if (typeof iconName !== 'string' || iconName === '') return undefined
  const exported = iconExports[iconExportName(iconName)]
  return typeof exported === 'function' ? (exported as IconComponent) : undefined
}

/**
 * An `IconName` prop as a rendered element — the form the ReactNode-shaped
 * icon slots take (`ListGroupItem.descriptiveIcon`, `Notification.icon`, …).
 */
export function renderIconElement(iconName: unknown): ReactNode {
  const Icon = getIconComponent(iconName)
  return Icon ? <Icon /> : null
}

/**
 * The same name as a render function, which is what `IconButton` still
 * expects (`renderIcon?: (props: IconProps) => ReactNode`). It forwards the
 * `{ size, color }` pds-core computes for the button's kind and size, so the
 * icon paints to match rather than at its own defaults.
 */
export function iconRenderFunction(iconName: unknown): ((props: IconRenderProps) => ReactNode) | undefined {
  const Icon = getIconComponent(iconName)
  if (!Icon) return undefined
  return (props: IconRenderProps) => <Icon {...props} />
}

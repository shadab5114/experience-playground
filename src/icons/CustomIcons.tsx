import type { ReactNode, SVGProps } from 'react'

interface CustomIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number
}

/**
 * Small hand-authored icons for the handful of chrome actions pds-core's
 * icon set doesn't cover (copy, code/JSON, device toggle, send). Drawn in
 * the same spirit as pds-core's icons — simple, currentColor, square
 * viewBox — so they sit comfortably next to the real VDS ones.
 */
function IconFrame({ size = 18, children, ...rest }: CustomIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={false}
      {...rest}
    >
      {children}
    </svg>
  )
}

export function CopyIcon(props: CustomIconProps) {
  return (
    <IconFrame {...props}>
      <rect x="8" y="8" width="13" height="13" rx="2.5" />
      <path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8" />
    </IconFrame>
  )
}

export function CodeIcon(props: CustomIconProps) {
  return (
    <IconFrame {...props}>
      <polyline points="9 7 3 13 9 19" />
      <polyline points="15 7 21 13 15 19" />
    </IconFrame>
  )
}

export function DesktopIcon(props: CustomIconProps) {
  return (
    <IconFrame {...props}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </IconFrame>
  )
}

export function MobileIcon(props: CustomIconProps) {
  return (
    <IconFrame {...props}>
      <rect x="6.5" y="2" width="11" height="20" rx="2.5" />
      <line x1="12" y1="18.3" x2="12.01" y2="18.3" />
    </IconFrame>
  )
}

export function SendIcon(props: CustomIconProps) {
  return (
    <IconFrame {...props}>
      <polygon points="21 2 13.5 21 10.5 13.5 3 10.5 21 2" />
    </IconFrame>
  )
}

export function ImpactsIcon(props: CustomIconProps) {
  return (
    <IconFrame {...props}>
      <rect x="3" y="3" width="11" height="11" rx="2" />
      <path d="M9 14v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-3" />
    </IconFrame>
  )
}

export function GripIcon(props: CustomIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="9" cy="5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="9" cy="19" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="19" r="0.8" fill="currentColor" stroke="none" />
    </IconFrame>
  )
}

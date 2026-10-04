import type { ReactNode } from 'react'
import styles from './Button.module.css'

type Variant = 'default' | 'primary' | 'danger' | 'dangerSolid'

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  variant?: Variant
  small?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
}

/** A text button for the Studio chrome. IconButton stays the icon-only one. */
export function Button({
  children,
  onClick,
  variant = 'default',
  small,
  disabled,
  type = 'button',
  title,
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant] ?? ''} ${small ? styles.small : ''}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

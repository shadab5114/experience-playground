import type { MouseEventHandler, ReactNode } from 'react'
import styles from './IconButton.module.css'

interface IconButtonProps {
  icon: ReactNode
  /** Accessible name. Always set as `title`/`aria-label`; shown as visible text only when `showLabel`. */
  label: string
  showLabel?: boolean
  active?: boolean
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  type?: 'button' | 'submit'
}

/** A small frosted-glass icon button used throughout the chrome (toolbar, header, chat input). */
export function IconButton({ icon, label, showLabel, active, disabled, onClick, type = 'button' }: IconButtonProps) {
  return (
    <button
      type={type}
      className={`${styles.button} ${showLabel ? styles.wide : ''} ${active ? styles.active : ''}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {showLabel && <span className={styles.label}>{label}</span>}
    </button>
  )
}

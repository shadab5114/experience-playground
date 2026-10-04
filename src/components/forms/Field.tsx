import { useId, type ReactNode } from 'react'
import styles from './Forms.module.css'

interface FieldProps {
  label: string
  required?: boolean
  /** The "↳ helps the agent find this" line under the control. */
  hint?: string
  error?: string
  /** Receives the id to wire up `htmlFor`/`aria-describedby`. */
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode
}

/**
 * Label + control + hint/error. The hint and error are wired through
 * `aria-describedby` rather than only being visually adjacent, so the reason a
 * field exists is available to a screen reader too.
 */
export function Field({ label, required, hint, error, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {required && (
          <span className={styles.required} aria-hidden="true">
            required
          </span>
        )}
      </div>
      {children({ id, describedBy })}
      {hint && (
        <span className={styles.hint} id={hintId}>
          ↳ {hint}
        </span>
      )}
      {error && (
        <span className={styles.error} id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

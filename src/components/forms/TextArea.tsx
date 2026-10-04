import styles from './Forms.module.css'

interface TextAreaProps {
  id?: string
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  mono?: boolean
  describedBy?: string
  ariaLabel?: string
  /** Off for the JSON pane: browser spellcheck underlines every component name. */
  spellCheck?: boolean
}

export function TextArea({
  id,
  value,
  onChange,
  rows = 4,
  placeholder,
  disabled,
  invalid,
  mono,
  describedBy,
  ariaLabel,
  spellCheck,
}: TextAreaProps) {
  return (
    <textarea
      id={id}
      className={`${styles.textarea} ${mono ? styles.mono : ''} ${invalid ? styles.invalid : ''}`}
      value={value}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={spellCheck}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

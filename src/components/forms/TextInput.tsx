import styles from './Forms.module.css'

interface TextInputProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  mono?: boolean
  describedBy?: string
  ariaLabel?: string
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  mono,
  describedBy,
  ariaLabel,
}: TextInputProps) {
  return (
    <input
      id={id}
      type="text"
      className={`${styles.control} ${mono ? styles.mono : ''} ${invalid ? styles.invalid : ''}`}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

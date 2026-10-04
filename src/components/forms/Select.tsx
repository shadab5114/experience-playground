import styles from './Forms.module.css'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  id?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Shown as a disabled first option when `value` is empty. */
  placeholder?: string
  disabled?: boolean
  describedBy?: string
  ariaLabel?: string
}

export function Select({
  id,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  describedBy,
  ariaLabel,
}: SelectProps) {
  return (
    <select
      id={id}
      className={styles.control}
      value={value}
      disabled={disabled}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder !== undefined && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

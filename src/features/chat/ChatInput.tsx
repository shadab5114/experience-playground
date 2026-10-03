import type { FormEvent } from 'react'
import { SendIcon } from '../../icons'
import styles from './ChatInput.module.css'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  disabled?: boolean
  placeholder: string
}

export function ChatInput({ value, onChange, onSubmit, disabled, placeholder }: ChatInputProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        className={styles.input}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label="Chat input"
      />
      <button className={styles.submit} type="submit" disabled={disabled || !value.trim()} aria-label="Send" title="Send">
        <SendIcon size={16} />
      </button>
    </form>
  )
}

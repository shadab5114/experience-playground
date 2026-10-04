import { useState, type KeyboardEvent } from 'react'
import styles from './Forms.module.css'

interface TagInputProps {
  id?: string
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  disabled?: boolean
  describedBy?: string
}

/**
 * Chips plus a text entry. Enter or comma commits a tag; Backspace in an empty
 * entry removes the last one. Duplicates and blanks are dropped silently —
 * there is nothing useful to say about typing a tag twice.
 */
export function TagInput({ id, value, onChange, placeholder, disabled, describedBy }: TagInputProps) {
  const [entry, setEntry] = useState('')

  const commit = (raw: string) => {
    const tag = raw.trim()
    if (!tag || value.includes(tag)) {
      setEntry('')
      return
    }
    onChange([...value, tag])
    setEntry('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(entry)
      return
    }
    if (e.key === 'Backspace' && entry === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className={styles.tagInput}>
      {value.map((tag) => (
        <span key={tag} className={styles.tag}>
          {tag}
          <button
            type="button"
            className={styles.tagRemove}
            aria-label={`Remove tag ${tag}`}
            disabled={disabled}
            onClick={() => onChange(value.filter((t) => t !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        className={styles.tagEntry}
        value={entry}
        placeholder={value.length === 0 ? placeholder : undefined}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => setEntry(e.target.value)}
        onKeyDown={handleKeyDown}
        // Committing on blur keeps a half-typed tag from vanishing on Save.
        onBlur={() => commit(entry)}
      />
    </div>
  )
}

import type { ReactNode } from 'react'
import styles from './JsonView.module.css'

const TOKEN_RE = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

function classify(token: string): string {
  if (token.startsWith('"')) return /:\s*$/.test(token) ? styles.key : styles.string
  if (token === 'true' || token === 'false') return styles.boolean
  if (token === 'null') return styles.null
  return styles.number
}

function tokenize(json: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  TOKEN_RE.lastIndex = 0
  while ((match = TOKEN_RE.exec(json))) {
    if (match.index > lastIndex) parts.push(json.slice(lastIndex, match.index))
    parts.push(
      <span key={key++} className={classify(match[0])}>
        {match[0]}
      </span>,
    )
    lastIndex = TOKEN_RE.lastIndex
  }
  parts.push(json.slice(lastIndex))
  return parts
}

/** Read-only, formatted JSON view with a lightweight syntax highlighter. */
export function JsonView({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2)
  return (
    <pre className={styles.jsonView}>
      <code>{tokenize(json)}</code>
    </pre>
  )
}

import type { CompositionRecord } from '@experience-agent/contract'
import styles from './StudioView.module.css'

interface CompositionListProps {
  compositions: CompositionRecord[]
  onOpen: (compositionId: string) => void
}

export function CompositionList({ compositions, onOpen }: CompositionListProps) {
  if (compositions.length === 0) {
    return (
      <div className={`${styles.message} ${styles.messageInfo}`}>
        No compositions yet. Create one, or import the pack's samples from the sidebar.
      </div>
    )
  }

  return (
    <div className={styles.list}>
      {compositions.map((record) => (
        <button
          key={record.compositionId}
          type="button"
          className={styles.listRow}
          onClick={() => onOpen(record.compositionId)}
        >
          <span className={styles.listMain}>
            <span className={styles.listName}>{record.name}</span>
            <span className={styles.listMeta}>
              {record.compositionId} · {record.family} · {record.description}
            </span>
          </span>
          <span className={styles.listRight}>
            {record.tags.map((tag) => (
              <span key={tag} className={styles.chip}>
                {tag}
              </span>
            ))}
            <span className={styles.chip}>{record.type}</span>
            {record.origin === 'sample' && <span className={`${styles.chip} ${styles.chipSample}`}>Sample</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

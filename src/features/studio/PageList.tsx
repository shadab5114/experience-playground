import type { PageTemplateRecord } from '@experience-agent/contract'
import styles from './StudioView.module.css'

interface PageListProps {
  pages: PageTemplateRecord[]
  onOpen: (pageTemplateId: string) => void
}

export function PageList({ pages, onOpen }: PageListProps) {
  if (pages.length === 0) {
    return (
      <div className={`${styles.message} ${styles.messageInfo}`}>
        No page templates yet. Create one, or import the pack's samples from the sidebar.
      </div>
    )
  }

  return (
    <div className={styles.list}>
      {pages.map((page) => (
        <button
          key={page.pageTemplateId}
          type="button"
          className={styles.listRow}
          onClick={() => onOpen(page.pageTemplateId)}
        >
          <span className={styles.listMain}>
            <span className={styles.listName}>{page.name}</span>
            <span className={styles.listMeta}>
              {page.pageTemplateId}
              {page.description ? ` · ${page.description}` : ''}
            </span>
          </span>
          <span className={styles.listRight}>
            {page.slots.length === 0 ? (
              <span className={styles.chip}>no slots</span>
            ) : (
              page.slots.map((slot) => (
                <span key={slot} className={styles.chip}>
                  {slot}
                </span>
              ))
            )}
            {page.origin === 'sample' && <span className={`${styles.chip} ${styles.chipSample}`}>Sample</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

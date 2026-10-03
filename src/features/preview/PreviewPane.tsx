import { useEffect, useState } from 'react'
import { A2UIRenderer } from '../../a2ui/renderer/A2UIRenderer'
import { getCurrentVersion, useTaskStore } from '../task/taskStore'
import { ImpactsView } from '../impacts/ImpactsView'
import { PreviewToolbar } from './PreviewToolbar'
import { JsonView } from './JsonView'
import styles from './PreviewPane.module.css'

export function PreviewPane() {
  const task = useTaskStore((s) => s.task)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(timer)
  }, [toast])

  if (!task) {
    return (
      <div className={styles.pane}>
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Show experience preview</p>
          <p className={styles.emptySubtitle}>All UI rendered here is A2UI based</p>
        </div>
      </div>
    )
  }

  const version = getCurrentVersion(task)
  const isJson = task.view.mode === 'json'
  const isImpacts = task.view.mode === 'impacts'
  const isMobile = task.view.device === 'mobile'

  return (
    <div className={styles.pane}>
      <PreviewToolbar onCopied={() => setToast('JSON copied')} />
      {isImpacts ? (
        <ImpactsView />
      ) : (
        <div className={styles.stage}>
          {isJson ? (
            <JsonView value={version.a2ui} />
          ) : (
            <div className={`${styles.tileWrapper} ${isMobile ? styles.tileWrapperMobile : ''}`}>
              <A2UIRenderer document={version.a2ui} />
            </div>
          )}
        </div>
      )}
      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  )
}

import { getCurrentVersion, hasUnsavedChanges, useTaskStore } from '../task/taskStore'
import { IconButton } from '../../components/IconButton'
import { Check, CodeIcon, CopyIcon, DesktopIcon, ImpactsIcon, MobileIcon, Redo, Undo } from '../../icons'
import styles from './PreviewToolbar.module.css'

export function PreviewToolbar({ onCopied }: { onCopied: () => void }) {
  const task = useTaskStore((s) => s.task)
  const mapping = useTaskStore((s) => s.mapping)
  const undo = useTaskStore((s) => s.undo)
  const redo = useTaskStore((s) => s.redo)
  const save = useTaskStore((s) => s.save)
  const setViewMode = useTaskStore((s) => s.setViewMode)
  const setDevice = useTaskStore((s) => s.setDevice)

  if (!task) return null

  const saved = !hasUnsavedChanges(task)
  const canUndo = task.versions.some((v) => v.number < task.currentVersion)
  const canRedo = task.versions.some((v) => v.number > task.currentVersion)
  const version = getCurrentVersion(task)
  const isJson = task.view.mode === 'json'
  const isImpacts = task.view.mode === 'impacts'
  const isMobile = task.view.device === 'mobile'
  const hasImpacts = Boolean(mapping && mapping.appearsIn.length > 0)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(version.a2ui, null, 2))
    onCopied()
  }

  return (
    <div className={styles.toolbar}>
      <span className={`${styles.pill} ${saved ? styles.pillSaved : styles.pillUnsaved}`}>
        {saved ? `Saved · v${task.currentVersion}` : `Unsaved changes · v${task.currentVersion}`}
      </span>

      <div className={styles.group}>
        <IconButton icon={<Undo size={16} />} label="Undo" disabled={!canUndo} onClick={undo} />
        <IconButton icon={<Redo size={16} />} label="Redo" disabled={!canRedo} onClick={redo} />
      </div>

      <div className={styles.spacer} />

      <div className={styles.group}>
        <IconButton
          icon={<CodeIcon size={16} />}
          label={isJson ? 'Show preview' : 'Show A2UI JSON'}
          active={isJson}
          onClick={() => setViewMode(isJson ? 'preview' : 'json')}
        />
        <IconButton icon={<CopyIcon size={16} />} label="Copy JSON" onClick={() => void handleCopy()} />
        {hasImpacts && (
          <IconButton
            icon={<ImpactsIcon size={16} />}
            label={isImpacts ? 'Hide impacts' : 'View impacts'}
            active={isImpacts}
            onClick={() => setViewMode(isImpacts ? 'preview' : 'impacts')}
          />
        )}
      </div>

      <div className={styles.group}>
        <IconButton
          icon={isMobile ? <DesktopIcon size={16} /> : <MobileIcon size={16} />}
          label={isMobile ? 'Switch to desktop view' : 'Switch to mobile view'}
          onClick={() => setDevice(isMobile ? 'desktop' : 'mobile')}
        />
      </div>

      <button type="button" className={styles.saveButton} disabled={saved} onClick={() => void save()}>
        <Check size={14} />
        Save
      </button>
    </div>
  )
}
